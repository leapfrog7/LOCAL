package in.local.vault;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Streams the existing v1 backup format without materializing the vault in the WebView. */
@CapacitorPlugin(name = "BackupExport")
public class BackupExportPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private String session;
    private File file;
    private BackupOutput output;

    @Override public void load() {
        File[] files = getContext().getCacheDir().listFiles();
        if (files != null) for (File candidate : files)
            if (candidate.getName().matches("backup-[a-f0-9-]{36}\\.localbackup")) candidate.delete();
    }


    @PluginMethod public void begin(PluginCall call) { worker.execute(() -> {
        if (session != null) { call.reject("A backup is already in progress."); return; }
        byte[] key = null;
        try {
            key = Base64.decode(call.getString("key", ""), Base64.NO_WRAP);
            byte[] iv = Base64.decode(call.getString("iv", ""), Base64.NO_WRAP);
            if (key.length != 32 || iv.length != 12) throw new IOException("Invalid backup key.");
            String header = call.getString("header", "");
            if (header.length() > 2048 || !header.endsWith("\"ciphertext\":\"")) throw new IOException("Invalid backup header.");
            session = UUID.randomUUID().toString();
            file = new File(getContext().getCacheDir(), "backup-" + session + ".localbackup");
            output = new BackupOutput(file, key, iv, header);
            JSObject result = new JSObject(); result.put("session", session); call.resolve(result);
        } catch (Exception error) { cleanup(); call.reject("Could not start the encrypted backup.", error); }
        finally { if (key != null) Arrays.fill(key, (byte) 0); }
    }); }

    private void check(PluginCall call) throws IOException {
        if (session == null || !session.equals(call.getString("session"))) throw new IOException("Backup session expired. Please try again.");
    }

    @PluginMethod public void append(PluginCall call) { worker.execute(() -> {
        try {
            check(call);
            String text = call.getString("text", "");
            if (text.length() > 131072 || output == null) throw new IOException("Invalid backup chunk.");
            output.append(text); call.resolve();
        } catch (Exception error) { cleanup(); call.reject("Could not write the encrypted backup. Check free storage.", error); }
    }); }

    @PluginMethod public void finish(PluginCall call) { worker.execute(() -> {
        try {
            check(call);
            output.finish();
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/octet-stream");
            intent.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "LOCAL.localbackup"));
            getActivity().runOnUiThread(() -> {
                try { startActivityForResult(call, intent, "saved"); }
                catch (Exception error) { worker.execute(() -> { cleanup(); call.reject("No save-location picker is available.", error); }); }
            });
        } catch (Exception error) { cleanup(); call.reject("Could not finish the encrypted backup.", error); }
    }); }

    @ActivityCallback private void saved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        worker.execute(() -> {
            Uri target = result.getData() == null ? null : result.getData().getData();
            try {
                check(call);
                boolean cancelled = result.getResultCode() != Activity.RESULT_OK || target == null;
                if (!cancelled) {
                    try (InputStream input = new FileInputStream(file); OutputStream output = getContext().getContentResolver().openOutputStream(target, "wt")) {
                        if (output == null) throw new IOException("The chosen location is not writable.");
                        byte[] buffer = new byte[32768]; int read;
                        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    }
                }
                JSObject response = new JSObject(); response.put("cancelled", cancelled); call.resolve(response);
            } catch (Exception error) {
                if (target != null) try { android.provider.DocumentsContract.deleteDocument(getContext().getContentResolver(), target); } catch (Exception ignored) { }
                call.reject("Backup could not be saved. Check the selected location and free storage.", error);
            } finally { cleanup(); }
        });
    }

    @PluginMethod public void abort(PluginCall call) { worker.execute(() -> {
        if (session != null && session.equals(call.getString("session"))) cleanup();
        call.resolve();
    }); }
    private void cleanup() {
        try { if (output != null) output.close(); } catch (Exception ignored) { }
        if (file != null) file.delete();
        output = null; file = null; session = null;
    }
    @Override protected void handleOnDestroy() { worker.execute(this::cleanup); worker.shutdown(); super.handleOnDestroy(); }
}

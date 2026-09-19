package in.local.vault;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "PdfImport")
public class PdfImportPlugin extends Plugin {
    private static final int MAX_PAGES = 200;
    private static final float IMPORT_SCALE = 160f / 72f;
    private static final int MAX_RENDER_DIMENSION = 4096;
    private final ExecutorService importExecutor = Executors.newSingleThreadExecutor();
    private volatile boolean cancelled;
    private volatile boolean importing;
    private File activeDirectory;
    private String activeTitle;
    private ProgressDialog progress;
    private AlertDialog passwordDialog;

    @Override public void load() {
        // A previous process may have died while holding decrypted import pages.
        deleteTree(new File(getContext().getCacheDir(), "pdf-imports"));
    }

    @PluginMethod
    public void pick(PluginCall call) {
        if (importing) { call.reject("A PDF is already being opened."); return; }
        importing = true;
        cancelled = false;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        try { startActivityForResult(call, intent, "pickedPdf"); }
        catch (Exception error) { importing = false; call.reject("No PDF picker is available on this device.", error); }
    }

    @ActivityCallback
    private void pickedPdf(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            importing = false;
            JSObject response = new JSObject();
            response.put("cancelled", true);
            response.put("pages", new JSArray());
            call.resolve(response);
            return;
        }
        Intent data = result.getData();
        Uri source = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || source == null) {
            importing = false;
            call.reject("LOCAL could not open the selected PDF.");
            return;
        }

        // Activity result callbacks run on the main thread. PDFBox parsing and page
        // rendering can be expensive (especially for unusual embedded image formats),
        // so never perform the import inline with the WebView/UI lifecycle.
        showProgress("Opening PDF…");
        importExecutor.execute(() -> preparePdf(call, source));
    }

    private void preparePdf(PluginCall call, Uri source) {
        File directory = new File(getContext().getCacheDir(), "pdf-imports" + File.separator + UUID.randomUUID());
        File localPdf = new File(directory, "source.pdf");
        try {
            activeDirectory = directory;
            activeTitle = displayName(source).replaceFirst("(?i)\\.pdf$", "");
            if (!directory.mkdirs()) throw new IllegalStateException("Could not prepare PDF import storage.");
            copyUri(source, localPdf);
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(localPdf, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(descriptor)) {
                if (renderer.getPageCount() > MAX_PAGES) throw new IllegalArgumentException("PDF import supports up to " + MAX_PAGES + " pages at a time.");
            } catch (SecurityException locked) {
                unlock(call, "", false);
                return;
            }
            renderPdf(call, localPdf);
        } catch (Exception error) { fail(call, error); }
        catch (OutOfMemoryError error) { fail(call, new IllegalStateException("This PDF is too large to open on this device. Try fewer pages.")); }
    }

    private void askPassword(PluginCall call, boolean incorrect) {
        getActivity().runOnUiThread(() -> {
            dismissProgress();
            if (cancelled || getActivity().isFinishing()) { cancelImport(call); return; }
            LinearLayout fields = new LinearLayout(getContext()); fields.setOrientation(LinearLayout.VERTICAL);
            int pad = (int) (24 * getContext().getResources().getDisplayMetrics().density); fields.setPadding(pad, 0, pad, 0);
            EditText password = new EditText(getContext()); password.setSingleLine(true);
            password.setHint("PDF password"); password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            if (android.os.Build.VERSION.SDK_INT >= 26) password.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            fields.addView(password);
            CheckBox saveCopy = new CheckBox(getContext()); saveCopy.setText("Save an unlocked copy after opening"); fields.addView(saveCopy);
            passwordDialog = new AlertDialog.Builder(getActivity()).setTitle(incorrect ? "Incorrect password" : "Unlock PDF")
                .setMessage((incorrect ? "Please try again. " : "") + "Enter this PDF’s password. LOCAL does not store it. Imported pages are readable inside LOCAL; the original file stays unchanged.")
                .setView(fields).setNegativeButton("Cancel", (dialog, which) -> cancelImport(call))
                .setPositiveButton("Unlock", null).setOnCancelListener(dialog -> cancelImport(call)).create();
            passwordDialog.setOnShowListener(dialog -> passwordDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
                String value = password.getText().toString();
                if (value.isEmpty()) { password.setError("Enter the PDF password."); return; }
                boolean save = saveCopy.isChecked(); password.setText(""); passwordDialog.dismiss();
                showProgress("Unlocking PDF…"); importExecutor.execute(() -> unlock(call, value, save));
            }));
            passwordDialog.show();
            passwordDialog.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
        });
    }

    private void unlock(PluginCall call, String password, boolean saveCopy) {
        try {
            if (cancelled) { cancelImport(call); return; }
            PDFBoxResourceLoader.init(getContext());
            File unlocked = new File(activeDirectory, "unlocked.pdf");
            PdfPasswordService.unlock(new File(activeDirectory, "source.pdf"), unlocked, password, activeDirectory, MAX_PAGES);
            if (cancelled) { cancelImport(call); return; }
            if (saveCopy) {
                getActivity().runOnUiThread(() -> {
                    dismissProgress();
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("application/pdf");
                    intent.putExtra(Intent.EXTRA_TITLE, activeTitle + " - unlocked.pdf");
                    try { startActivityForResult(call, intent, "savedUnlocked"); }
                    catch (Exception error) { fail(call, error); }
                });
            } else renderPdf(call, unlocked);
        } catch (InvalidPasswordException error) { askPassword(call, !password.isEmpty()); }
        catch (Exception error) { fail(call, error); }
        catch (OutOfMemoryError error) { fail(call, new IllegalStateException("This PDF is too large to unlock on this device. Try a smaller PDF.")); }
    }

    @ActivityCallback private void savedUnlocked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        showProgress("Preparing PDF pages…");
        importExecutor.execute(() -> {
            Uri target = result.getData() == null ? null : result.getData().getData();
            try {
                File unlocked = new File(activeDirectory, "unlocked.pdf");
                if (result.getResultCode() == Activity.RESULT_OK && target != null) {
                    try (InputStream input = new FileInputStream(unlocked); OutputStream output = getContext().getContentResolver().openOutputStream(target, "wt")) {
                        if (output == null) throw new IllegalStateException("The chosen location is not writable.");
                        byte[] buffer = new byte[32768]; int read;
                        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    }
                    getActivity().runOnUiThread(() -> Toast.makeText(getContext(), "Unlocked PDF copy saved", Toast.LENGTH_LONG).show());
                }
                renderPdf(call, unlocked);
            } catch (Exception error) {
                if (target != null) try { android.provider.DocumentsContract.deleteDocument(getContext().getContentResolver(), target); } catch (Exception ignored) { }
                fail(call, error);
            }
        });
    }

    private void renderPdf(PluginCall call, File localPdf) {
        File directory = activeDirectory;
        try {
            JSArray pages = new JSArray();
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(localPdf, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(descriptor)) {
                if (renderer.getPageCount() > MAX_PAGES) throw new IllegalArgumentException("PDF import supports up to " + MAX_PAGES + " pages at a time.");
                for (int index = 0; index < renderer.getPageCount(); index += 1) {
                    if (cancelled) { cancelImport(call); return; }
                    showProgress("Preparing page " + (index + 1) + " of " + renderer.getPageCount());
                    try (PdfRenderer.Page pdfPage = renderer.openPage(index)) {
                        float scale = Math.min(IMPORT_SCALE, Math.min(
                            (float) MAX_RENDER_DIMENSION / pdfPage.getWidth(),
                            (float) MAX_RENDER_DIMENSION / pdfPage.getHeight()
                        ));
                        int width = Math.max(1, Math.round(pdfPage.getWidth() * scale));
                        int height = Math.max(1, Math.round(pdfPage.getHeight() * scale));
                        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
                        try {
                            new Canvas(bitmap).drawColor(Color.WHITE);
                            Matrix transform = new Matrix();
                            transform.setScale(scale, scale);
                            pdfPage.render(bitmap, null, transform, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                            File target = new File(directory, "page-" + (index + 1) + ".jpg");
                            try (OutputStream output = new FileOutputStream(target)) {
                                if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)) throw new IllegalStateException("Could not render PDF page " + (index + 1) + ".");
                            }
                            JSObject page = new JSObject();
                            page.put("uri", Uri.fromFile(target).toString());
                            page.put("name", target.getName());
                            pages.put(page);
                        } finally {
                            bitmap.recycle();
                        }
                    }
                }
            }
            JSObject response = new JSObject();
            response.put("cancelled", false);
            if (cancelled) { cancelImport(call); return; }
            response.put("title", activeTitle);
            response.put("token", directory.getName());
            response.put("pages", pages);
            importing = false;
            new File(directory, "source.pdf").delete();
            new File(directory, "unlocked.pdf").delete();
            activeDirectory = null;
            getActivity().runOnUiThread(this::dismissProgress);
            call.resolve(response);
        } catch (Exception error) { fail(call, error); }
        catch (OutOfMemoryError error) { fail(call, new IllegalStateException("This PDF is too large to render on this device. Try fewer pages.")); }
    }

    private void showProgress(String message) { getActivity().runOnUiThread(() -> {
        if (getActivity().isFinishing() || cancelled) return;
        if (progress == null) { progress = new ProgressDialog(getActivity()); progress.setTitle("Opening PDF"); progress.setIndeterminate(true); progress.setCancelable(true); progress.setOnCancelListener(dialog -> cancelled = true); }
        progress.setMessage(message); progress.show();
    }); }
    private void dismissProgress() { if (progress != null) { progress.dismiss(); progress = null; } }
    private void cancelImport(PluginCall call) {
        cancelled = true;
        if (importExecutor.isShutdown()) return;
        importExecutor.execute(() -> {
            cleanupActive(); JSObject result = new JSObject(); result.put("cancelled", true); result.put("pages", new JSArray()); call.resolve(result);
        });
    }
    private void fail(PluginCall call, Exception error) {
        cleanupActive();
        if (cancelled) { JSObject result = new JSObject(); result.put("cancelled", true); result.put("pages", new JSArray()); call.resolve(result); }
        else call.reject(error instanceof IllegalArgumentException || error instanceof IllegalStateException ? error.getMessage() : "LOCAL could not open this PDF. It may be damaged or use unsupported encryption.", error);
    }
    private void cleanupActive() { deleteTree(activeDirectory); activeDirectory = null; importing = false; getActivity().runOnUiThread(this::dismissProgress); }
    private static void deleteTree(File directory) { if (directory == null) return; File[] files = directory.listFiles(); if (files != null) for (File file : files) deleteTree(file); directory.delete(); }
    @PluginMethod public void release(PluginCall call) {
        String token = call.getString("token", "");
        if (!token.matches("[a-f0-9-]{36}")) { call.reject("Invalid import session."); return; }
        importExecutor.execute(() -> { deleteTree(new File(getContext().getCacheDir(), "pdf-imports/" + token)); call.resolve(); });
    }

    @Override
    protected void handleOnDestroy() {
        cancelled = true;
        if (passwordDialog != null) passwordDialog.dismiss();
        dismissProgress();
        importExecutor.execute(this::cleanupActive);
        importExecutor.shutdown();
        super.handleOnDestroy();
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) return cursor.getString(column);
            }
        }
        return "Imported PDF";
    }

    private void copyUri(Uri source, File target) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(source); OutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new IllegalStateException("The selected PDF could not be read.");
            byte[] buffer = new byte[32 * 1024];
            int read;
            long total = 0;
            while ((read = input.read(buffer)) != -1) {
                if (cancelled) throw new IllegalStateException("Opening cancelled.");
                total += read;
                if (total > 256L * 1024 * 1024) throw new IllegalArgumentException("PDF import supports files up to 256 MB. Try splitting this PDF first.");
                output.write(buffer, 0, read);
            }
        }
    }
}

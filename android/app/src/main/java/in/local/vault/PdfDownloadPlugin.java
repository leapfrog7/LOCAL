package in.local.vault;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.FileProvider;
import androidx.annotation.RequiresApi;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;
import java.util.Locale;

import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission;
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy;

@CapacitorPlugin(name = "PdfDownload")
public class PdfDownloadPlugin extends Plugin {
    private static final String TAG = "LOCAL-PdfDownload";
    private Uri lastSavedPdf;

    @PluginMethod
    public void protectPdf(PluginCall call) {
        String sourcePath = call.getString("sourcePath");
        String password = call.getString("password");
        if (sourcePath == null || password == null || password.length() < 8) {
            call.reject("Use a PDF password of at least 8 characters.");
            return;
        }

        File temporary = null;
        File backup = null;
        try {
            File dataDirectory = getContext().getFilesDir().getCanonicalFile();
            File source = new File(dataDirectory, sourcePath).getCanonicalFile();
            if (!source.getPath().startsWith(dataDirectory.getPath() + File.separator) || !source.isFile()) {
                call.reject("The prepared PDF could not be found.");
                return;
            }

            PDFBoxResourceLoader.init(getContext());
            temporary = new File(source.getParentFile(), source.getName() + ".protected.tmp");
            backup = new File(source.getParentFile(), source.getName() + ".unprotected.bak");
            if (temporary.exists() && !temporary.delete()) throw new IllegalStateException("Could not clear an earlier temporary PDF.");
            if (backup.exists() && !backup.delete()) throw new IllegalStateException("Could not clear an earlier PDF backup.");

            try (PDDocument document = PDDocument.load(source)) {
                AccessPermission permissions = new AccessPermission();
                String ownerPassword = UUID.randomUUID().toString() + UUID.randomUUID();
                StandardProtectionPolicy policy = new StandardProtectionPolicy(ownerPassword, password, permissions);
                policy.setEncryptionKeyLength(256);
                policy.setPreferAES(true);
                document.protect(policy);
                document.save(temporary);
            }

            if (!source.renameTo(backup)) throw new IllegalStateException("Could not prepare the original PDF for replacement.");
            if (!temporary.renameTo(source)) {
                if (!backup.renameTo(source)) throw new IllegalStateException("Could not restore the original PDF.");
                throw new IllegalStateException("Could not install the protected PDF.");
            }
            if (!backup.delete()) Log.w(TAG, "Protected PDF installed but its private backup could not be removed immediately.");

            JSObject result = new JSObject();
            result.put("algorithm", "AES-256");
            Log.i(TAG, "Password protection applied.");
            call.resolve(result);
        } catch (Exception error) {
            if (temporary != null && temporary.exists()) temporary.delete();
            call.reject("Could not password-protect this PDF.", error);
        }
    }

    @PluginMethod
    public void savePdf(PluginCall call) {
        String sourcePath = call.getString("sourcePath");
        String filename = call.getString("filename");
        if (sourcePath == null || filename == null || !filename.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
            call.reject("A valid PDF filename and source are required.");
            return;
        }

        try {
            File dataDirectory = getContext().getFilesDir().getCanonicalFile();
            File source = new File(dataDirectory, sourcePath).getCanonicalFile();
            if (!source.getPath().startsWith(dataDirectory.getPath() + File.separator) || !source.isFile()) {
                call.reject("The prepared PDF could not be found.");
                return;
            }

            String location;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                SavedPdf saved = saveWithMediaStore(source, filename);
                location = saved.location;
                lastSavedPdf = saved.uri;
            } else {
                File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloads.exists() && !downloads.mkdirs()) throw new IllegalStateException("Downloads folder is unavailable.");
                File target = availableFile(downloads, filename);
                try (InputStream input = new FileInputStream(source); OutputStream output = new FileOutputStream(target)) {
                    copy(input, output);
                }
                location = target.getAbsolutePath();
                lastSavedPdf = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", target);
            }

            JSObject result = new JSObject();
            result.put("location", location);
            result.put("uri", lastSavedPdf.toString());
            Log.i(TAG, "PDF export completed.");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not save the PDF to Downloads.", error);
        }
    }

    @PluginMethod
    public void openPdf(PluginCall call) {
        if (lastSavedPdf == null) {
            call.reject("Download the PDF before opening it.");
            return;
        }
        try {
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(lastSavedPdf, "application/pdf");
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(view, "Open PDF with");
            Log.i(TAG, "Opening PDF chooser inside LOCAL task.");
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception error) {
            call.reject("No app on this device could open the PDF.", error);
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private SavedPdf saveWithMediaStore(File source, String filename) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + File.separator + "LOCAL");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("Android could not create the download.");
        try {
            try (InputStream input = new FileInputStream(source); OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) throw new IllegalStateException("Android could not open the download.");
                copy(input, output);
            }
            ContentValues complete = new ContentValues();
            complete.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, complete, null, null);
            return new SavedPdf(Environment.DIRECTORY_DOWNLOADS + File.separator + "LOCAL" + File.separator + filename, uri);
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            throw error;
        }
    }

    private static class SavedPdf {
        final String location;
        final Uri uri;
        SavedPdf(String location, Uri uri) { this.location = location; this.uri = uri; }
    }

    private static File availableFile(File directory, String filename) {
        File candidate = new File(directory, filename);
        if (!candidate.exists()) return candidate;
        String stem = filename.substring(0, filename.length() - 4);
        for (int index = 2; ; index += 1) {
            candidate = new File(directory, stem + " (" + index + ").pdf");
            if (!candidate.exists()) return candidate;
        }
    }

    private static void copy(InputStream input, OutputStream output) throws Exception {
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
    }
}

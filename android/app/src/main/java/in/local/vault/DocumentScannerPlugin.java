package in.local.vault;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

@CapacitorPlugin(name = "DocumentScanner")
public class DocumentScannerPlugin extends Plugin {
    @PluginMethod
    public void scan(PluginCall call) {
        startActivityForResult(call, new Intent(getContext(), DocumentScannerActivity.class), "scanResult");
    }

    @ActivityCallback
    private void scanResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        if (activityResult.getResultCode() == Activity.RESULT_CANCELED) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            cancelled.put("pages", new JSArray());
            call.resolve(cancelled);
            return;
        }
        if (activityResult.getResultCode() != Activity.RESULT_OK) {
            Intent data = activityResult.getData();
            String message = data == null ? null : data.getStringExtra(DocumentScannerActivity.EXTRA_ERROR);
            call.reject(message == null ? "The document scanner could not start." : message);
            return;
        }

        try {
            GmsDocumentScanningResult result = GmsDocumentScanningResult.fromActivityResultIntent(activityResult.getData());
            if (result == null || result.getPages() == null || result.getPages().isEmpty()) {
                call.reject("The document scanner returned no pages.");
                return;
            }
            File directory = new File(getContext().getCacheDir(), "mlkit-scans" + File.separator + UUID.randomUUID());
            if (!directory.mkdirs()) throw new IllegalStateException("Could not prepare scanned pages.");
            JSArray pages = new JSArray();
            int pageNumber = 1;
            for (GmsDocumentScanningResult.Page page : result.getPages()) {
                File target = new File(directory, "page-" + pageNumber + ".jpg");
                copyUri(page.getImageUri(), target);
                JSObject value = new JSObject();
                value.put("uri", Uri.fromFile(target).toString());
                value.put("name", target.getName());
                pages.put(value);
                pageNumber += 1;
            }
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("pages", pages);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("LOCAL could not read the scanned pages.", error);
        }
    }

    private void copyUri(Uri source, File target) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(source); OutputStream output = new FileOutputStream(target)) {
            if (input == null) throw new IllegalStateException("A scanned page could not be opened.");
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        }
    }
}

package in.local.vault;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException;
import com.tom_roush.pdfbox.rendering.ImageType;
import com.tom_roush.pdfbox.rendering.PDFRenderer;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.UUID;

@CapacitorPlugin(name = "PdfImport")
public class PdfImportPlugin extends Plugin {
    private static final int MAX_PAGES = 200;

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        startActivityForResult(call, intent, "pickedPdf");
    }

    @ActivityCallback
    private void pickedPdf(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            JSObject response = new JSObject();
            response.put("cancelled", true);
            response.put("pages", new JSArray());
            call.resolve(response);
            return;
        }
        Intent data = result.getData();
        Uri source = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || source == null) {
            call.reject("LOCAL could not open the selected PDF.");
            return;
        }

        File directory = new File(getContext().getCacheDir(), "pdf-imports" + File.separator + UUID.randomUUID());
        File localPdf = new File(directory, "source.pdf");
        try {
            if (!directory.mkdirs()) throw new IllegalStateException("Could not prepare PDF import storage.");
            copyUri(source, localPdf);
            PDFBoxResourceLoader.init(getContext());
            JSArray pages = new JSArray();
            try (PDDocument document = PDDocument.load(localPdf)) {
                if (document.isEncrypted()) throw new IllegalArgumentException("Password-protected PDFs must be unlocked before importing.");
                if (document.getNumberOfPages() > MAX_PAGES) throw new IllegalArgumentException("PDF import supports up to " + MAX_PAGES + " pages at a time.");
                PDFRenderer renderer = new PDFRenderer(document);
                for (int index = 0; index < document.getNumberOfPages(); index += 1) {
                    Bitmap bitmap = renderer.renderImageWithDPI(index, 160, ImageType.RGB);
                    File target = new File(directory, "page-" + (index + 1) + ".jpg");
                    try (OutputStream output = new FileOutputStream(target)) {
                        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)) throw new IllegalStateException("Could not render PDF page " + (index + 1) + ".");
                    } finally {
                        bitmap.recycle();
                    }
                    JSObject page = new JSObject();
                    page.put("uri", Uri.fromFile(target).toString());
                    page.put("name", target.getName());
                    pages.put(page);
                }
            }
            JSObject response = new JSObject();
            response.put("cancelled", false);
            String name = displayName(source);
            response.put("title", (name == null || name.trim().isEmpty() ? "Imported PDF" : name).replaceFirst("(?i)\\.pdf$", ""));
            response.put("pages", pages);
            call.resolve(response);
        } catch (InvalidPasswordException error) {
            call.reject("Password-protected PDFs must be unlocked before importing.", error);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), error);
        } catch (Exception error) {
            call.reject("LOCAL could not import this PDF. It may be damaged or unsupported.", error);
        } finally {
            if (localPdf.exists()) localPdf.delete();
        }
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
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        }
    }
}

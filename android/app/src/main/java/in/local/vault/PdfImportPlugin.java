package in.local.vault;

import android.app.Activity;
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

        // Activity result callbacks run on the main thread. PDFBox parsing and page
        // rendering can be expensive (especially for unusual embedded image formats),
        // so never perform the import inline with the WebView/UI lifecycle.
        importExecutor.execute(() -> importPdf(call, source));
    }

    private void importPdf(PluginCall call, Uri source) {
        File directory = new File(getContext().getCacheDir(), "pdf-imports" + File.separator + UUID.randomUUID());
        File localPdf = new File(directory, "source.pdf");
        try {
            if (!directory.mkdirs()) throw new IllegalStateException("Could not prepare PDF import storage.");
            copyUri(source, localPdf);
            JSArray pages = new JSArray();
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(localPdf, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(descriptor)) {
                if (renderer.getPageCount() > MAX_PAGES) throw new IllegalArgumentException("PDF import supports up to " + MAX_PAGES + " pages at a time.");
                for (int index = 0; index < renderer.getPageCount(); index += 1) {
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
            String name = displayName(source);
            response.put("title", (name == null || name.trim().isEmpty() ? "Imported PDF" : name).replaceFirst("(?i)\\.pdf$", ""));
            response.put("pages", pages);
            call.resolve(response);
        } catch (SecurityException error) {
            call.reject("Password-protected PDFs must be unlocked before importing.", error);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), error);
        } catch (Exception error) {
            call.reject("LOCAL could not import this PDF. It may be damaged or unsupported.", error);
        } finally {
            if (localPdf.exists()) localPdf.delete();
        }
    }

    @Override
    protected void handleOnDestroy() {
        importExecutor.shutdownNow();
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
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        }
    }
}

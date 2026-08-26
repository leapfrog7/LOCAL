package in.local.vault;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;

@RunWith(AndroidJUnit4.class)
public class PdfImportRenderingTest {
    @Test
    public void rendersEveryImportedPdfPageLocally() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PDFBoxResourceLoader.init(context);
        File source = new File(context.getCacheDir(), "local-import-test.pdf");
        try {
            try (PDDocument created = new PDDocument()) {
                created.addPage(new PDPage(PDRectangle.A4));
                created.addPage(new PDPage(PDRectangle.LETTER));
                created.save(source);
            }
            try (ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer renderer = new PdfRenderer(descriptor)) {
                assertEquals(2, renderer.getPageCount());
                for (int index = 0; index < renderer.getPageCount(); index += 1) {
                    try (PdfRenderer.Page page = renderer.openPage(index)) {
                        Bitmap bitmap = Bitmap.createBitmap(page.getWidth(), page.getHeight(), Bitmap.Config.ARGB_8888);
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                        assertTrue(bitmap.getWidth() > 500);
                        assertTrue(bitmap.getHeight() > 700);
                        bitmap.recycle();
                    }
                }
            }
        } finally {
            source.delete();
        }
    }
}

package in.local.vault;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.graphics.Bitmap;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle;
import com.tom_roush.pdfbox.rendering.ImageType;
import com.tom_roush.pdfbox.rendering.PDFRenderer;

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
            try (PDDocument loaded = PDDocument.load(source)) {
                assertEquals(2, loaded.getNumberOfPages());
                PDFRenderer renderer = new PDFRenderer(loaded);
                for (int index = 0; index < loaded.getNumberOfPages(); index += 1) {
                    Bitmap bitmap = renderer.renderImageWithDPI(index, 96, ImageType.RGB);
                    assertTrue(bitmap.getWidth() > 700);
                    assertTrue(bitmap.getHeight() > 900);
                    bitmap.recycle();
                }
            }
        } finally {
            source.delete();
        }
    }
}

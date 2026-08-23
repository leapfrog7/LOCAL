package in.local.vault;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.pdmodel.PDPage;
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission;
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException;
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;

@RunWith(AndroidJUnit4.class)
public class PdfPasswordProtectionTest {
    @Test
    public void aes256PdfRequiresTheCorrectPassword() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PDFBoxResourceLoader.init(context);
        File protectedPdf = new File(context.getCacheDir(), "local-password-test.pdf");

        try {
            try (PDDocument document = new PDDocument()) {
                document.addPage(new PDPage());
                StandardProtectionPolicy policy = new StandardProtectionPolicy("owner-test-password", "LOCAL-test-123", new AccessPermission());
                policy.setEncryptionKeyLength(256);
                policy.setPreferAES(true);
                document.protect(policy);
                document.save(protectedPdf);
            }

            assertTrue(protectedPdf.isFile() && protectedPdf.length() > 0);
            try (PDDocument ignored = PDDocument.load(protectedPdf)) {
                fail("The protected PDF opened without a password.");
            } catch (InvalidPasswordException expected) {
                // Expected: readers must supply the user password.
            }
            try (PDDocument unlocked = PDDocument.load(protectedPdf, "LOCAL-test-123")) {
                assertTrue(unlocked.isEncrypted());
            }
        } finally {
            if (protectedPdf.exists()) protectedPdf.delete();
        }
    }
}

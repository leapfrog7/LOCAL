package in.local.vault;

import static org.junit.Assert.*;
import android.content.Context;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.*;
import com.tom_roush.pdfbox.pdmodel.encryption.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.spec.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class EncryptionFlowTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    private static byte[] bytes(File file) throws Exception {
        try (InputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[32768]; int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toByteArray();
        }
    }
    @Test public void streamedBackupUsesCompatibleAuthenticatedCiphertext() throws Exception {
        File file = File.createTempFile("backup-test", ".json", context().getCacheDir());
        byte[] key = new byte[32], iv = new byte[12]; new SecureRandom().nextBytes(key); new SecureRandom().nextBytes(iv);
        String expected = "{\"documents\":[],\"title\":\"हिन्दी 🔒\"}";
        try {
            try (BackupOutput output = new BackupOutput(file, key, iv, "{\"ciphertext\":\"")) {
                output.append(expected.substring(0, 10)); output.append(expected.substring(10)); output.finish();
            }
            JSONObject envelope = new JSONObject(new String(bytes(file), StandardCharsets.UTF_8));
            byte[] ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP);
            Cipher decrypt = Cipher.getInstance("AES/GCM/NoPadding");
            decrypt.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            assertEquals(expected, new String(decrypt.doFinal(ciphertext), StandardCharsets.UTF_8));
            ciphertext[0] ^= 1;
            decrypt.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            try { decrypt.doFinal(ciphertext); fail("Modified backup must fail authentication"); } catch (javax.crypto.AEADBadTagException expectedFailure) { }
        } finally { file.delete(); }
    }
    @Test public void manyBackupChunksDoNotAccumulateInMemory() throws Exception {
        File file = File.createTempFile("backup-large", ".json", context().getCacheDir());
        byte[] key = new byte[32], iv = new byte[12]; new SecureRandom().nextBytes(key); new SecureRandom().nextBytes(iv);
        char[] chars = new char[65536]; java.util.Arrays.fill(chars, 'x'); String chunk = new String(chars);
        try {
            try (BackupOutput output = new BackupOutput(file, key, iv, "{\"ciphertext\":\"")) {
                for (int index = 0; index < 512; index++) output.append(chunk);
                output.finish();
            }
            assertTrue(file.length() > 32L * 1024 * 1024);
        } finally { file.delete(); }
    }
    @Test public void passwordPdfRetriesAndSavesUnlockedCopyWithoutChangingOriginal() throws Exception {
        PDFBoxResourceLoader.init(context());
        File source = File.createTempFile("locked", ".pdf", context().getCacheDir());
        File target = new File(context().getCacheDir(), "unlocked-test.pdf");
        try {
            try (PDDocument pdf = new PDDocument()) {
                pdf.addPage(new PDPage()); pdf.addPage(new PDPage());
                StandardProtectionPolicy policy = new StandardProtectionPolicy("owner-password", "user-password", new AccessPermission());
                policy.setEncryptionKeyLength(256); policy.setPreferAES(true); pdf.protect(policy); pdf.save(source);
            }
            byte[] original = bytes(source);
            try { PdfPasswordService.unlock(source, target, "wrong", context().getCacheDir(), 200); fail("Wrong password accepted"); }
            catch (InvalidPasswordException expected) { assertFalse(target.exists()); }
            PdfPasswordService.unlock(source, target, "user-password", context().getCacheDir(), 200);
            try (PDDocument opened = PDDocument.load(target)) { assertFalse(opened.isEncrypted()); assertEquals(2, opened.getNumberOfPages()); }
            assertArrayEquals(original, bytes(source));
            try { PDDocument.load(source).close(); fail("Original lost its password"); } catch (InvalidPasswordException expected) { }
        } finally { source.delete(); target.delete(); }
    }
}

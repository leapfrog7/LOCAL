package in.local.vault;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import org.junit.Test;

public class VaultEncryptionTest {
    private static void delete(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) delete(child);
        file.delete();
    }

    @Test
    public void encryptRevealAndRejectTampering() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        String documentId = "vault-test";
        String relativePath = "LOCAL/documents/" + documentId + "/pages/page-original.jpg";
        File folder = new File(context.getFilesDir(), "LOCAL/documents/" + documentId);
        delete(folder);
        File source = VaultEncryptionPlugin.resolveDocumentFile(context, documentId, relativePath);
        assertTrue(source.getParentFile().mkdirs());
        byte[] original = "LOCAL private file encryption test".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        try (FileOutputStream output = new FileOutputStream(source)) { output.write(original); }

        String encryptedPath = VaultEncryptionPlugin.encrypt(context, documentId, relativePath);
        File encrypted = VaultEncryptionPlugin.resolveDocumentFile(context, documentId, encryptedPath);
        assertFalse(source.exists());
        assertTrue(encrypted.exists());
        assertFalse(java.util.Arrays.equals(original, Files.readAllBytes(encrypted.toPath())));

        File revealed = new File(context.getFilesDir(), "LOCAL/private-session/vault-test/page.jpg");
        VaultEncryptionPlugin.decryptTo(context, documentId, encryptedPath, revealed);
        assertArrayEquals(original, Files.readAllBytes(revealed.toPath()));

        byte[] tampered = Files.readAllBytes(encrypted.toPath());
        tampered[tampered.length - 1] ^= 1;
        Files.write(encrypted.toPath(), tampered);
        try {
            VaultEncryptionPlugin.decryptTo(context, documentId, encryptedPath, new File(revealed.getParentFile(), "tampered.jpg"));
            fail("Tampered AES-GCM data must be rejected.");
        } catch (Exception expected) {
            assertTrue(expected.getMessage() != null || expected.getCause() != null);
        } finally {
            delete(folder);
            delete(revealed.getParentFile());
        }
    }
}

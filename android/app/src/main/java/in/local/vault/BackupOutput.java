package in.local.vault;

import android.util.Base64;
import android.util.Base64OutputStream;
import java.io.*;
import java.nio.charset.StandardCharsets;
import javax.crypto.Cipher;
import javax.crypto.CipherOutputStream;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Writes a v1 JSON envelope with streaming base64 AES-GCM ciphertext. */
final class BackupOutput implements Closeable {
    private final FileOutputStream raw;
    private final CipherOutputStream encrypted;
    private boolean finished;

    BackupOutput(File file, byte[] key, byte[] iv, String header) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        raw = new FileOutputStream(file);
        try {
            raw.write(header.getBytes(StandardCharsets.UTF_8));
            OutputStream nonClosing = new FilterOutputStream(raw) {
                @Override public void close() throws IOException { flush(); }
                @Override public void write(byte[] b, int off, int len) throws IOException { out.write(b, off, len); }
            };
            encrypted = new CipherOutputStream(new Base64OutputStream(nonClosing, Base64.NO_WRAP), cipher);
        } catch (Exception error) { raw.close(); throw error; }
    }
    void append(String text) throws IOException {
        if (finished) throw new IOException("Backup is already complete.");
        encrypted.write(text.getBytes(StandardCharsets.UTF_8));
    }
    void finish() throws IOException {
        if (finished) throw new IOException("Backup is already complete.");
        encrypted.close();
        raw.write("\"}".getBytes(StandardCharsets.UTF_8));
        raw.getFD().sync(); raw.close(); finished = true;
    }
    @Override public void close() throws IOException {
        try { if (!finished) encrypted.close(); } finally { raw.close(); }
    }
}

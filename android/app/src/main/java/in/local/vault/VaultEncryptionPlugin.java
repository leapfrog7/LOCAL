package in.local.vault;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.CipherInputStream;
import javax.crypto.CipherOutputStream;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "VaultEncryption")
public class VaultEncryptionPlugin extends Plugin {
    private static final String KEY_ALIAS = "LOCAL_PRIVATE_FILES_V1";
    private static final byte[] MAGIC = "LOCALV1\n".getBytes(StandardCharsets.US_ASCII);
    private static final int IV_LENGTH = 12;
    private static final String ENCRYPTED_SUFFIX = ".localenc";

    static SecretKey key(Context context) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    static File resolveDocumentFile(Context context, String documentId, String relativePath) throws IOException {
        if (documentId == null || !documentId.matches("[A-Za-z0-9_-]+")) throw new IOException("Invalid document identifier.");
        String prefix = "LOCAL/documents/" + documentId + "/";
        if (relativePath == null || !relativePath.startsWith(prefix) || relativePath.contains("..")) throw new IOException("File is outside this document.");
        File root = context.getFilesDir().getCanonicalFile();
        File file = new File(root, relativePath).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator)) throw new IOException("File is outside LOCAL storage.");
        return file;
    }

    private static void replace(File temporary, File target) throws IOException {
        if (target.exists() && !target.delete()) throw new IOException("Could not replace protected file.");
        if (!temporary.renameTo(target)) throw new IOException("Could not finalize protected file.");
    }

    static String encrypt(Context context, String documentId, String relativePath) throws Exception {
        if (relativePath.endsWith(ENCRYPTED_SUFFIX)) return relativePath;
        File source = resolveDocumentFile(context, documentId, relativePath);
        if (!source.exists()) throw new IOException("Source file is missing.");
        File target = resolveDocumentFile(context, documentId, relativePath + ENCRYPTED_SUFFIX);
        File temporary = new File(target.getPath() + ".tmp");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(context));
        cipher.updateAAD(relativePath.getBytes(StandardCharsets.UTF_8));
        try (FileInputStream input = new FileInputStream(source); FileOutputStream rawOutput = new FileOutputStream(temporary)) {
            rawOutput.write(MAGIC);
            rawOutput.write(cipher.getIV());
            try (CipherOutputStream output = new CipherOutputStream(rawOutput, cipher)) { transfer(input, output); }
        } catch (Exception error) { temporary.delete(); throw error; }
        replace(temporary, target);
        if (!source.delete()) { target.delete(); throw new IOException("Could not remove the unprotected source file."); }
        return relativePath + ENCRYPTED_SUFFIX;
    }

    static void decryptTo(Context context, String documentId, String encryptedPath, File target) throws Exception {
        if (!encryptedPath.endsWith(ENCRYPTED_SUFFIX)) throw new IOException("File is not protected.");
        File source = resolveDocumentFile(context, documentId, encryptedPath);
        if (!source.exists()) throw new IOException("Protected file is missing.");
        String originalPath = encryptedPath.substring(0, encryptedPath.length() - ENCRYPTED_SUFFIX.length());
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("Could not create the private session.");
        File temporary = new File(target.getPath() + ".tmp");
        try (FileInputStream rawInput = new FileInputStream(source)) {
            byte[] magic = new byte[MAGIC.length];
            if (rawInput.read(magic) != MAGIC.length || !java.util.Arrays.equals(magic, MAGIC)) throw new IOException("Unsupported protected-file format.");
            byte[] iv = new byte[IV_LENGTH];
            if (rawInput.read(iv) != IV_LENGTH) throw new IOException("Protected file is incomplete.");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(context), new GCMParameterSpec(128, iv));
            cipher.updateAAD(originalPath.getBytes(StandardCharsets.UTF_8));
            try (CipherInputStream input = new CipherInputStream(rawInput, cipher); FileOutputStream output = new FileOutputStream(temporary)) {
                transfer(input, output);
                output.getFD().sync();
            }
        } catch (Exception error) { temporary.delete(); throw error; }
        replace(temporary, target);
    }

    private static void transfer(java.io.InputStream input, java.io.OutputStream output) throws IOException {
        byte[] buffer = new byte[64 * 1024];
        int length;
        while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        file.delete();
    }

    @PluginMethod
    public void encryptDocument(PluginCall call) {
        transform(call, true);
    }

    @PluginMethod
    public void decryptDocument(PluginCall call) {
        transform(call, false);
    }

    private void transform(PluginCall call, boolean encrypting) {
        try {
            String documentId = call.getString("documentId");
            JSArray paths = call.getArray("paths", new JSArray());
            JSObject mappings = new JSObject();
            for (int index = 0; index < paths.length(); index++) {
                String path = paths.getString(index);
                if (path == null || path.isEmpty()) continue;
                if (encrypting) mappings.put(path, encrypt(getContext(), documentId, path));
                else {
                    if (!path.endsWith(ENCRYPTED_SUFFIX)) { mappings.put(path, path); continue; }
                    String plainPath = path.substring(0, path.length() - ENCRYPTED_SUFFIX.length());
                    File target = resolveDocumentFile(getContext(), documentId, plainPath);
                    decryptTo(getContext(), documentId, path, target);
                    File source = resolveDocumentFile(getContext(), documentId, path);
                    if (!source.delete()) { target.delete(); throw new IOException("Could not remove the protected source file."); }
                    mappings.put(path, plainPath);
                }
            }
            JSObject result = new JSObject();
            result.put("paths", mappings);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(encrypting ? "Could not protect the private document." : "Could not remove private-file protection.", error);
        }
    }

    @PluginMethod
    public void revealDocument(PluginCall call) {
        try {
            String documentId = call.getString("documentId");
            String sessionId = call.getString("sessionId");
            if (sessionId == null || !sessionId.matches("[A-Za-z0-9_-]+")) throw new IOException("Invalid private session.");
            JSArray paths = call.getArray("paths", new JSArray());
            JSObject mappings = new JSObject();
            File session = new File(getContext().getFilesDir(), "LOCAL/private-session/" + sessionId).getCanonicalFile();
            for (int index = 0; index < paths.length(); index++) {
                String path = paths.getString(index);
                if (path == null || path.isEmpty()) continue;
                if (!path.endsWith(ENCRYPTED_SUFFIX)) { mappings.put(path, path); continue; }
                String originalName = new File(path.substring(0, path.length() - ENCRYPTED_SUFFIX.length())).getName();
                String revealedPath = "LOCAL/private-session/" + sessionId + "/" + index + "-" + originalName;
                decryptTo(getContext(), documentId, path, new File(session, index + "-" + originalName));
                mappings.put(path, revealedPath);
            }
            JSObject result = new JSObject();
            result.put("paths", mappings);
            call.resolve(result);
        } catch (Exception error) { call.reject("Could not open the private document.", error); }
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null || !sessionId.matches("[A-Za-z0-9_-]+")) { call.reject("Invalid private session."); return; }
        deleteRecursively(new File(getContext().getFilesDir(), "LOCAL/private-session/" + sessionId));
        call.resolve();
    }

    @PluginMethod
    public void clearAllSessions(PluginCall call) {
        deleteRecursively(new File(getContext().getFilesDir(), "LOCAL/private-session"));
        call.resolve();
    }
}

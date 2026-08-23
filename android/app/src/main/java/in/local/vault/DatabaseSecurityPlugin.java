package in.local.vault;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

@CapacitorPlugin(name = "DatabaseSecurity")
public class DatabaseSecurityPlugin extends Plugin {
    private static final String DATABASE_NAME = "local_vaultSQLite.db";
    private static final String[] SUFFIXES = { "", "-wal", "-shm" };

    private File backupDirectory() {
        return new File(getContext().getNoBackupFilesDir(), "database-encryption-migration");
    }

    private File databaseFile(String suffix) {
        File primary = getContext().getDatabasePath(DATABASE_NAME);
        return suffix.isEmpty() ? primary : new File(primary.getPath() + suffix);
    }

    private File backupFile(String suffix) {
        return new File(backupDirectory(), DATABASE_NAME + suffix + ".bak");
    }

    private static void copy(File source, File target) throws IOException {
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Could not create migration backup directory.");
        }
        File temporary = new File(target.getPath() + ".tmp");
        try (FileInputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(temporary)) {
            byte[] buffer = new byte[64 * 1024];
            int length;
            while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
            output.getFD().sync();
        }
        if (target.exists() && !target.delete()) throw new IOException("Could not replace migration backup.");
        if (!temporary.renameTo(target)) throw new IOException("Could not finalize migration backup.");
    }

    @PluginMethod
    public void inspect(PluginCall call) {
        File database = databaseFile("");
        JSObject result = new JSObject();
        result.put("exists", database.exists());
        result.put("bytes", database.exists() ? database.length() : 0);
        call.resolve(result);
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        try {
            File primary = databaseFile("");
            if (!primary.exists()) {
                JSObject result = new JSObject();
                result.put("created", false);
                call.resolve(result);
                return;
            }
            File pristineBackup = backupFile("");
            if (!pristineBackup.exists()) {
                for (String suffix : SUFFIXES) {
                    File source = databaseFile(suffix);
                    if (source.exists()) copy(source, backupFile(suffix));
                }
            }
            JSObject result = new JSObject();
            result.put("created", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not create the database migration backup.", error);
        }
    }

    @PluginMethod
    public void restore(PluginCall call) {
        try {
            if (!backupFile("").exists()) {
                call.reject("No database migration backup is available.");
                return;
            }
            for (String suffix : SUFFIXES) {
                File backup = backupFile(suffix);
                File destination = databaseFile(suffix);
                if (backup.exists()) copy(backup, destination);
                else if (destination.exists() && !destination.delete()) throw new IOException("Could not remove a database sidecar.");
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not restore the database migration backup.", error);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        for (String suffix : SUFFIXES) {
            File backup = backupFile(suffix);
            if (backup.exists() && !backup.delete()) {
                call.reject("Could not clear the database migration backup.");
                return;
            }
        }
        File directory = backupDirectory();
        if (directory.exists()) directory.delete();
        call.resolve();
    }
}

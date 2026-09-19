package in.local.vault;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PdfDownloadPlugin.class);
        registerPlugin(PdfImportPlugin.class);
        registerPlugin(BackupExportPlugin.class);
        registerPlugin(DocumentScannerPlugin.class);
        registerPlugin(MlKitOcrPlugin.class);
        registerPlugin(BackgroundProcessingPlugin.class);
        registerPlugin(BiometricLockPlugin.class);
        registerPlugin(DatabaseSecurityPlugin.class);
        registerPlugin(VaultEncryptionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

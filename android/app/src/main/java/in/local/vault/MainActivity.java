package in.local.vault;

import android.os.Bundle;
import android.graphics.Color;
import androidx.core.view.WindowCompat;
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
        getWindow().setStatusBarColor(Color.rgb(248, 246, 240));
        getWindow().setNavigationBarColor(Color.rgb(251, 250, 246));
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(true);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightNavigationBars(true);
    }
}

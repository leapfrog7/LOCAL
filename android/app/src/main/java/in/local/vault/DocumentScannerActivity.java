package in.local.vault;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.google.mlkit.vision.documentscanner.GmsDocumentScanner;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;

public class DocumentScannerActivity extends ComponentActivity {
    public static final String EXTRA_ERROR = "scannerError";

    private final ActivityResultLauncher<IntentSenderRequest> scannerLauncher = registerForActivityResult(
        new ActivityResultContracts.StartIntentSenderForResult(),
        result -> {
            setResult(result.getResultCode(), result.getData());
            finish();
        }
    );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState != null) return;

        GmsDocumentScannerOptions options = new GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(50)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build();
        GmsDocumentScanner scanner = GmsDocumentScanning.getClient(options);
        scanner.getStartScanIntent(this)
            .addOnSuccessListener(intentSender -> scannerLauncher.launch(new IntentSenderRequest.Builder(intentSender).build()))
            .addOnFailureListener(error -> {
                Intent result = new Intent();
                result.putExtra(EXTRA_ERROR, error.getMessage());
                setResult(Activity.RESULT_FIRST_USER, result);
                finish();
            });
    }
}

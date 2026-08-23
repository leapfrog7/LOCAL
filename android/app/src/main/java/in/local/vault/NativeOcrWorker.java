package in.local.vault;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.Data;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.List;
import java.util.TimeZone;

public class NativeOcrWorker extends Worker {
    public static final String DOCUMENT_ID = "documentId";

    public NativeOcrWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        String documentId = getInputData().getString(DOCUMENT_ID);
        if (documentId == null || !documentId.matches("[A-Za-z0-9._-]{1,128}")) return Result.failure();
        TextRecognizer recognizer = TextRecognition.getClient(new DevanagariTextRecognizerOptions.Builder().build());
        BarcodeScanner barcodeScanner = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder().setBarcodeFormats(
            Barcode.FORMAT_QR_CODE, Barcode.FORMAT_DATA_MATRIX, Barcode.FORMAT_AZTEC, Barcode.FORMAT_PDF417,
            Barcode.FORMAT_CODE_128, Barcode.FORMAT_CODE_39, Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8,
            Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_ITF, Barcode.FORMAT_CODABAR).build());
        try {
            JSONObject metadata = new JSONObject(read(metadataFile(getApplicationContext(), documentId)));
            JSONArray sourcePages = metadata.getJSONArray("pages");
            JSONArray completedPages = new JSONArray();
            JSONArray errors = new JSONArray();
            writeResult(documentId, "running", completedPages, errors, null, 0, sourcePages.length());
            for (int index = 0; index < sourcePages.length(); index++) {
                if (isStopped()) return Result.failure();
                JSONObject page = sourcePages.getJSONObject(index);
                if ("complete".equals(page.optString("ocrState")) && !page.optString("ocrText").trim().isEmpty()) {
                    completedPages.put(existingResult(page));
                    continue;
                }
                try {
                    completedPages.put(recognizePage(recognizer, barcodeScanner, page));
                } catch (Exception error) {
                    errors.put(new JSONObject().put("pageId", page.optString("id")).put("message", safeMessage(error)));
                }
                writeResult(documentId, "running", completedPages, errors, null, index + 1, sourcePages.length());
            }
            if (isStopped()) return Result.failure();
            String state = errors.length() == 0 ? "succeeded" : "failed";
            writeResult(documentId, state, completedPages, errors, errors.length() == 0 ? null : "One or more pages could not be recognized.", sourcePages.length(), sourcePages.length());
            return errors.length() == 0 ? Result.success() : Result.failure();
        } catch (Exception error) {
            boolean retrying = getRunAttemptCount() < 2 && !isStopped();
            try { writeResult(documentId, retrying ? "running" : "failed", new JSONArray(), new JSONArray(), safeMessage(error), 0, 0); }
            catch (Exception ignored) {}
            return retrying ? Result.retry() : Result.failure();
        } finally {
            recognizer.close();
            barcodeScanner.close();
        }
    }

    private JSONObject recognizePage(TextRecognizer recognizer, BarcodeScanner barcodeScanner, JSONObject page) throws Exception {
        String relativePath = page.optString("ocrImagePath");
        if (relativePath.isEmpty()) relativePath = page.optString("imagePath");
        File source = safeDataFile(getApplicationContext(), relativePath);
        Bitmap bitmap = BitmapFactory.decodeFile(source.getAbsolutePath());
        if (bitmap == null) throw new IllegalArgumentException("The stored OCR image could not be decoded.");
        int rotation = normalizedRotation(page.optInt("rotation", 0));
        int width = rotation % 180 == 0 ? bitmap.getWidth() : bitmap.getHeight();
        int height = rotation % 180 == 0 ? bitmap.getHeight() : bitmap.getWidth();
        try {
            InputImage image = InputImage.fromBitmap(bitmap, rotation);
            Text text = Tasks.await(recognizer.process(image));
            List<Barcode> barcodes = Tasks.await(barcodeScanner.process(image));
            if (text.getText().trim().isEmpty() && barcodes.isEmpty()) throw new IllegalStateException("No readable text or code was detected on this page.");
            return mappedResult(page.optString("id"), text, barcodes, width, height);
        } finally {
            bitmap.recycle();
        }
    }

    private static JSONObject mappedResult(String pageId, Text result, List<Barcode> detectedBarcodes, int width, int height) throws Exception {
        JSONArray words = new JSONArray();
        Set<String> languages = new LinkedHashSet<>();
        double weightedConfidence = 0;
        int confidenceWeight = 0;
        for (Text.TextBlock block : result.getTextBlocks()) for (Text.Line line : block.getLines()) for (Text.Element element : line.getElements()) {
            String value = element.getText().trim();
            Rect box = element.getBoundingBox();
            if (value.isEmpty() || box == null) continue;
            Float rawConfidence = element.getConfidence();
            double confidence = rawConfidence == null ? 0 : clamp(rawConfidence * 100, 0, 100);
            int weight = Math.max(1, value.length());
            if (rawConfidence != null) { weightedConfidence += confidence * weight; confidenceWeight += weight; }
            String language = element.getRecognizedLanguage();
            if (language != null && !language.isEmpty() && !"und".equals(language)) languages.add(language);
            JSONObject bounds = new JSONObject()
                .put("x", clamp((double) box.left / width, 0, 1))
                .put("y", clamp((double) box.top / height, 0, 1))
                .put("width", clamp((double) box.width() / width, 0, 1))
                .put("height", clamp((double) box.height() / height, 0, 1));
            words.put(new JSONObject().put("text", value).put("confidence", confidence).put("boundingBox", bounds));
        }
        addScriptLanguageHints(result.getText(), languages);
        JSONArray languageArray = new JSONArray();
        for (String language : languages) languageArray.put(language);
        JSONArray barcodes = new JSONArray();
        for (Barcode barcode : detectedBarcodes) {
            String rawValue = barcode.getRawValue();
            if (rawValue == null || rawValue.trim().isEmpty()) continue;
            barcodes.put(new JSONObject().put("rawValue", rawValue).put("displayValue", barcode.getDisplayValue()).put("format", barcodeFormat(barcode.getFormat())).put("valueType", barcodeType(barcode.getValueType())));
        }
        return new JSONObject()
            .put("pageId", pageId)
            .put("text", result.getText().trim())
            .put("confidence", confidenceWeight == 0 ? 0 : weightedConfidence / confidenceWeight)
            .put("languages", languageArray)
            .put("words", words)
            .put("barcodes", barcodes);
    }

    private static JSONObject existingResult(JSONObject page) throws Exception {
        return new JSONObject()
            .put("pageId", page.optString("id"))
            .put("text", page.optString("ocrText"))
            .put("confidence", page.optDouble("ocrConfidence", 0))
            .put("languages", page.optJSONArray("ocrLanguages") == null ? new JSONArray() : page.optJSONArray("ocrLanguages"))
            .put("words", page.optJSONArray("ocrWords") == null ? new JSONArray() : page.optJSONArray("ocrWords"))
            .put("barcodes", page.optJSONArray("barcodes") == null ? new JSONArray() : page.optJSONArray("barcodes"));
    }

    private void writeResult(String documentId, String state, JSONArray pages, JSONArray errors, String error, int completed, int total) throws Exception {
        JSONObject value = new JSONObject()
            .put("documentId", documentId)
            .put("state", state)
            .put("pages", pages)
            .put("errors", errors)
            .put("completedPages", completed)
            .put("totalPages", total)
            .put("updatedAt", timestamp());
        if (error != null) value.put("error", error);
        writeAtomically(resultFile(getApplicationContext(), documentId), value.toString());
        setProgressAsync(new Data.Builder().putInt("completedPages", completed).putInt("totalPages", total).build());
    }

    static File metadataFile(Context context, String documentId) {
        return new File(new File(new File(context.getFilesDir(), "LOCAL/documents"), documentId), "metadata.json");
    }

    static File resultFile(Context context, String documentId) {
        return new File(new File(new File(context.getFilesDir(), "LOCAL/documents"), documentId), "native-ocr-result.json");
    }

    static void deleteResult(Context context, String documentId) {
        File result = resultFile(context, documentId);
        if (result.isFile()) result.delete();
    }

    private static File safeDataFile(Context context, String relativePath) throws Exception {
        File root = context.getFilesDir().getCanonicalFile();
        File file = new File(root, relativePath).getCanonicalFile();
        if (!file.getPath().startsWith(root.getPath() + File.separator) || !file.isFile()) throw new IllegalArgumentException("The stored OCR image could not be found.");
        return file;
    }

    private static String read(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static void writeAtomically(File target, String content) throws Exception {
        File parent = target.getParentFile();
        if (parent == null || (!parent.isDirectory() && !parent.mkdirs())) throw new IllegalStateException("The OCR result directory could not be created.");
        File temporary = new File(parent, target.getName() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) {
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        if (target.isFile() && !target.delete()) throw new IllegalStateException("The previous OCR result could not be replaced.");
        if (!temporary.renameTo(target)) throw new IllegalStateException("The OCR result could not be committed.");
    }

    private static int normalizedRotation(int rotation) {
        int value = ((rotation % 360) + 360) % 360;
        return value == 90 || value == 180 || value == 270 ? value : 0;
    }

    private static void addScriptLanguageHints(String text, Set<String> languages) {
        boolean latin = false, devanagari = false;
        for (int index = 0; index < text.length();) {
            int codePoint = text.codePointAt(index);
            if ((codePoint >= 0x0041 && codePoint <= 0x007A) || (codePoint >= 0x00C0 && codePoint <= 0x024F)) latin = true;
            if (codePoint >= 0x0900 && codePoint <= 0x097F) devanagari = true;
            index += Character.charCount(codePoint);
        }
        if (latin && languages.stream().noneMatch(value -> value.toLowerCase().startsWith("en"))) languages.add("en");
        if (devanagari && languages.stream().noneMatch(value -> value.toLowerCase().startsWith("hi"))) languages.add("hi");
    }

    private static double clamp(double value, double minimum, double maximum) { return Math.max(minimum, Math.min(maximum, value)); }
    private static String barcodeFormat(int value) {
        if (value == Barcode.FORMAT_QR_CODE) return "QR_CODE"; if (value == Barcode.FORMAT_DATA_MATRIX) return "DATA_MATRIX";
        if (value == Barcode.FORMAT_AZTEC) return "AZTEC"; if (value == Barcode.FORMAT_PDF417) return "PDF417";
        if (value == Barcode.FORMAT_CODE_128) return "CODE_128"; if (value == Barcode.FORMAT_CODE_39) return "CODE_39";
        if (value == Barcode.FORMAT_EAN_13) return "EAN_13"; if (value == Barcode.FORMAT_EAN_8) return "EAN_8";
        if (value == Barcode.FORMAT_UPC_A) return "UPC_A"; if (value == Barcode.FORMAT_UPC_E) return "UPC_E";
        if (value == Barcode.FORMAT_ITF) return "ITF"; if (value == Barcode.FORMAT_CODABAR) return "CODABAR"; return "UNKNOWN";
    }
    private static String barcodeType(int value) {
        if (value == Barcode.TYPE_URL) return "URL"; if (value == Barcode.TYPE_EMAIL) return "EMAIL"; if (value == Barcode.TYPE_PHONE) return "PHONE";
        if (value == Barcode.TYPE_SMS) return "SMS"; if (value == Barcode.TYPE_WIFI) return "WIFI"; if (value == Barcode.TYPE_PRODUCT) return "PRODUCT";
        if (value == Barcode.TYPE_ISBN) return "ISBN"; if (value == Barcode.TYPE_CONTACT_INFO) return "CONTACT"; if (value == Barcode.TYPE_GEO) return "GEO";
        if (value == Barcode.TYPE_CALENDAR_EVENT) return "CALENDAR"; if (value == Barcode.TYPE_DRIVER_LICENSE) return "DRIVER_LICENSE"; return "TEXT";
    }
    private static String safeMessage(Exception error) { return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage(); }
    private static String timestamp() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }
}

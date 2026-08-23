package in.local.vault;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions;

import java.io.File;
import java.util.LinkedHashSet;
import java.util.Set;

@CapacitorPlugin(name = "MlKitOcr")
public class MlKitOcrPlugin extends Plugin {
    private final TextRecognizer recognizer = TextRecognition.getClient(new DevanagariTextRecognizerOptions.Builder().build());

    @PluginMethod
    public void recognize(PluginCall call) {
        String sourcePath = call.getString("sourcePath");
        String base64 = call.getString("base64");
        int rotation = normalizedRotation(call.getInt("rotation", 0));

        try {
            Bitmap bitmap = sourcePath == null ? decodeBase64(base64) : decodeStoredFile(sourcePath);
            if (bitmap == null) {
                call.reject("The OCR image could not be decoded.");
                return;
            }
            int resultWidth = rotation % 180 == 0 ? bitmap.getWidth() : bitmap.getHeight();
            int resultHeight = rotation % 180 == 0 ? bitmap.getHeight() : bitmap.getWidth();
            InputImage image = InputImage.fromBitmap(bitmap, rotation);
            recognizer.process(image)
                .addOnSuccessListener(text -> call.resolve(toResult(text, resultWidth, resultHeight)))
                .addOnFailureListener(error -> call.reject("ML Kit could not recognize this page.", error))
                .addOnCompleteListener(task -> bitmap.recycle());
        } catch (Exception error) {
            call.reject("LOCAL could not prepare this page for ML Kit OCR.", error);
        }
    }

    private Bitmap decodeStoredFile(String sourcePath) throws Exception {
        File dataDirectory = getContext().getFilesDir().getCanonicalFile();
        File source = new File(dataDirectory, sourcePath).getCanonicalFile();
        if (!source.getPath().startsWith(dataDirectory.getPath() + File.separator) || !source.isFile()) {
            throw new IllegalArgumentException("The stored OCR image could not be found.");
        }
        return BitmapFactory.decodeFile(source.getAbsolutePath());
    }

    private Bitmap decodeBase64(String value) {
        if (value == null || value.isEmpty()) return null;
        int comma = value.indexOf(',');
        String payload = comma >= 0 ? value.substring(comma + 1) : value;
        byte[] bytes = Base64.decode(payload, Base64.DEFAULT);
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    }

    private JSObject toResult(Text result, int width, int height) {
        JSArray words = new JSArray();
        Set<String> languages = new LinkedHashSet<>();
        double weightedConfidence = 0;
        int confidenceWeight = 0;

        for (Text.TextBlock block : result.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                for (Text.Element element : line.getElements()) {
                    String value = element.getText().trim();
                    Rect box = element.getBoundingBox();
                    if (value.isEmpty() || box == null) continue;
                    Float rawConfidence = element.getConfidence();
                    double confidence = rawConfidence == null ? 0 : clamp(rawConfidence.doubleValue(), 0, 1) * 100;
                    int weight = Math.max(1, value.length());
                    if (rawConfidence != null) {
                        weightedConfidence += confidence * weight;
                        confidenceWeight += weight;
                    }
                    String language = element.getRecognizedLanguage();
                    if (language != null && !language.isEmpty() && !"und".equals(language)) languages.add(language);

                    JSObject boundingBox = new JSObject();
                    boundingBox.put("x", clamp((double) box.left / width, 0, 1));
                    boundingBox.put("y", clamp((double) box.top / height, 0, 1));
                    boundingBox.put("width", clamp((double) box.width() / width, 0, 1));
                    boundingBox.put("height", clamp((double) box.height() / height, 0, 1));
                    JSObject word = new JSObject();
                    word.put("text", value);
                    word.put("confidence", confidence);
                    word.put("boundingBox", boundingBox);
                    words.put(word);
                }
            }
        }

        addScriptLanguageHints(result.getText(), languages);
        JSArray languageArray = new JSArray();
        for (String language : languages) languageArray.put(language);
        JSObject response = new JSObject();
        response.put("text", result.getText().trim());
        response.put("confidence", confidenceWeight == 0 ? 0 : weightedConfidence / confidenceWeight);
        response.put("languages", languageArray);
        response.put("words", words);
        return response;
    }

    private static void addScriptLanguageHints(String text, Set<String> languages) {
        boolean latin = false;
        boolean devanagari = false;
        for (int index = 0; index < text.length();) {
            int codePoint = text.codePointAt(index);
            if ((codePoint >= 0x0041 && codePoint <= 0x007A) || (codePoint >= 0x00C0 && codePoint <= 0x024F)) latin = true;
            if (codePoint >= 0x0900 && codePoint <= 0x097F) devanagari = true;
            index += Character.charCount(codePoint);
        }
        if (latin && !hasLanguage(languages, "en")) languages.add("en");
        if (devanagari && !hasLanguage(languages, "hi")) languages.add("hi");
    }

    private static boolean hasLanguage(Set<String> languages, String prefix) {
        for (String language : languages) if (language.toLowerCase().startsWith(prefix)) return true;
        return false;
    }

    private static int normalizedRotation(int rotation) {
        int value = ((rotation % 360) + 360) % 360;
        return value == 90 || value == 180 || value == 270 ? value : 0;
    }

    private static double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}

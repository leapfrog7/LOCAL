package in.local.vault;

import android.os.Handler;
import android.os.Looper;

import androidx.lifecycle.LiveData;
import androidx.lifecycle.Observer;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

@CapacitorPlugin(name = "BackgroundProcessing")
public class BackgroundProcessingPlugin extends Plugin {
    private static final String EVENT = "backgroundProcessingChanged";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void enqueue(PluginCall call) {
        String documentId = call.getString("documentId");
        if (!validDocumentId(documentId)) {
            call.reject("A valid document ID is required.");
            return;
        }
        boolean replace = call.getBoolean("replace", false);
        NativeOcrWorker.deleteResult(getContext(), documentId);
        Data input = new Data.Builder().putString(NativeOcrWorker.DOCUMENT_ID, documentId).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(NativeOcrWorker.class)
            .setInputData(input)
            .addTag(tag(documentId))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build();
        WorkManager manager = WorkManager.getInstance(getContext());
        manager.enqueueUniqueWork(workName(documentId), replace ? ExistingWorkPolicy.REPLACE : ExistingWorkPolicy.KEEP, request);
        observe(request.getId().toString(), documentId);
        JSObject response = new JSObject();
        response.put("workId", request.getId().toString());
        response.put("state", "enqueued");
        call.resolve(response);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String documentId = call.getString("documentId");
        if (!validDocumentId(documentId)) {
            call.reject("A valid document ID is required.");
            return;
        }
        WorkManager.getInstance(getContext()).cancelUniqueWork(workName(documentId));
        NativeOcrWorker.deleteResult(getContext(), documentId);
        call.resolve(new JSObject().put("state", "cancelled"));
    }

    @PluginMethod
    public void status(PluginCall call) {
        String documentId = call.getString("documentId");
        if (!validDocumentId(documentId)) {
            call.reject("A valid document ID is required.");
            return;
        }
        try {
            List<WorkInfo> infos = WorkManager.getInstance(getContext()).getWorkInfosForUniqueWork(workName(documentId)).get();
            WorkInfo latest = infos.isEmpty() ? null : infos.get(infos.size() - 1);
            JSObject response = new JSObject();
            response.put("state", latest == null ? "absent" : stateName(latest.getState()));
            if (latest != null) response.put("workId", latest.getId().toString());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("LOCAL could not inspect background OCR.", error);
        }
    }

    @PluginMethod
    public void result(PluginCall call) {
        String documentId = call.getString("documentId");
        if (!validDocumentId(documentId)) {
            call.reject("A valid document ID is required.");
            return;
        }
        File result = NativeOcrWorker.resultFile(getContext(), documentId);
        if (!result.isFile()) {
            call.resolve(new JSObject().put("state", "absent"));
            return;
        }
        try {
            String json;
            try (FileInputStream input = new FileInputStream(result); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
                json = output.toString(StandardCharsets.UTF_8.name());
            }
            call.resolve(JSObject.fromJSONObject(new JSONObject(json)));
        } catch (Exception error) {
            call.reject("LOCAL could not read the background OCR result.", error);
        }
    }

    @PluginMethod
    public void clearResult(PluginCall call) {
        String documentId = call.getString("documentId");
        if (!validDocumentId(documentId)) {
            call.reject("A valid document ID is required.");
            return;
        }
        NativeOcrWorker.deleteResult(getContext(), documentId);
        call.resolve();
    }

    private void observe(String workId, String documentId) {
        java.util.UUID id = java.util.UUID.fromString(workId);
        LiveData<WorkInfo> liveData = WorkManager.getInstance(getContext()).getWorkInfoByIdLiveData(id);
        Observer<WorkInfo> observer = new Observer<>() {
            @Override
            public void onChanged(WorkInfo info) {
                if (info == null) return;
                JSObject payload = new JSObject();
                payload.put("documentId", documentId);
                payload.put("state", stateName(info.getState()));
                notifyListeners(EVENT, payload);
                if (info.getState().isFinished()) liveData.removeObserver(this);
            }
        };
        mainHandler.post(() -> liveData.observeForever(observer));
    }

    static String workName(String documentId) { return "local-ocr:" + documentId; }
    static String tag(String documentId) { return "local-ocr-document:" + documentId; }

    private static boolean validDocumentId(String value) {
        return value != null && value.matches("[A-Za-z0-9._-]{1,128}");
    }

    private static String stateName(WorkInfo.State state) {
        return state.name().toLowerCase(java.util.Locale.ROOT);
    }
}

package com.homie.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Khoảnh khắc downloads inside the app: the WebView cannot download a blob, so the page hands the JPEG here
 * (save({ data: base64, fileName })) and it lands in the gallery under Pictures/Homie.
 */
@CapacitorPlugin(
    name = "MomentSaver",
    permissions = @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
)
public class MomentSaverPlugin extends Plugin {
    private static final String FAILED = "Không lưu được ảnh vào máy.";

    @PluginMethod
    public void save(PluginCall call) {
        // Android 10+ writes through MediaStore without any permission; 9 and older need storage access.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageAnswered");
            return;
        }
        write(call);
    }

    @PermissionCallback
    private void storageAnswered(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) write(call);
        else call.reject(FAILED);
    }

    private void write(PluginCall call) {
        String data = call.getString("data");
        String name = call.getString("fileName", "homie.jpg").replaceAll("[^A-Za-z0-9._-]", "_");
        if (data == null || data.isEmpty()) {
            call.reject(FAILED);
            return;
        }
        new Thread(() -> {
            Uri pending = null;
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                Uri uri;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContext().getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                    values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                    values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Homie");
                    values.put(MediaStore.Images.Media.IS_PENDING, 1);
                    pending = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                    if (pending == null) throw new IllegalStateException("insert");
                    try (OutputStream out = resolver.openOutputStream(pending)) {
                        if (out == null) throw new IllegalStateException("open");
                        out.write(bytes);
                    }
                    values.clear();
                    values.put(MediaStore.Images.Media.IS_PENDING, 0);
                    resolver.update(pending, values, null, null);
                    uri = pending;
                    pending = null;
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Homie");
                    if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("mkdir");
                    File file = new File(dir, name);
                    try (FileOutputStream out = new FileOutputStream(file)) {
                        out.write(bytes);
                    }
                    MediaScannerConnection.scanFile(getContext(), new String[] { file.getAbsolutePath() }, new String[] { "image/jpeg" }, null);
                    uri = Uri.fromFile(file);
                }
                JSObject result = new JSObject();
                result.put("uri", uri.toString());
                call.resolve(result);
            } catch (Exception error) {
                if (pending != null) getContext().getContentResolver().delete(pending, null, null);
                call.reject(FAILED);
            }
        }).start();
    }
}

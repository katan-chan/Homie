package com.homie.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.location.LocationRequest;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Vị trí: a foreground service that posts the phone's position to /api/location/point about every 2 minutes, with the
 * WebView's session cookie. It stops on "Dừng chia sẻ", when the battery drops below 20% without charging, or when the
 * session has expired, and reports sharing on/off to the backend itself. It is never restarted automatically.
 */
public class LocationService extends Service {
    static final String ACTION_START = "com.homie.app.location.START";
    static final String ACTION_STOP = "com.homie.app.location.STOP";
    static final String EXTRA_SERVER = "serverUrl";
    private static final String PREFS = "homie.location";
    private static final String CHANNEL = "location_share";
    private static final String ALERTS = "location_alerts";
    private static final int ONGOING_ID = 7100;
    private static final int ALERT_ID = 7101;
    private static final long INTERVAL_MS = 120_000;
    private static final int MIN_BATTERY = 20;
    private static final int TIMEOUT_MS = 60_000;

    // Lives as long as the process: a killed process means a stopped service, which a saved flag would not show.
    private static volatile boolean running;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private LocationManager locations;
    private String serverUrl;
    private boolean stopping;

    private final LocationListener listener = this::send;

    private final BroadcastReceiver batteryWatch = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            if (level >= 0 && level * 100 / Math.max(scale, 1) < MIN_BATTERY && plugged == 0) {
                alert("Đã tắt chia sẻ vị trí vì pin yếu (dưới 20%).");
                shutdown("battery");
            }
        }
    };

    static boolean isRunning(Context context) {
        return running;
    }

    static boolean batteryTooLow(Context context) {
        BatteryManager battery = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
        return battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) < MIN_BATTERY && !battery.isCharging();
    }

    private void setRunning(boolean value) {
        running = value;
        if (serverUrl != null) getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("server", serverUrl).apply();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            shutdown("user");
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action)) return START_NOT_STICKY;
        // Every startForegroundService() must be answered with startForeground(), even when already sharing.
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
        ServiceCompat.startForeground(this, ONGOING_ID, ongoing(), type);
        if (locations != null) return START_NOT_STICKY;
        serverUrl = intent.getStringExtra(EXTRA_SERVER);
        if (serverUrl == null || !hasPermission()) {
            shutdown("permission");
            return START_NOT_STICKY;
        }
        setRunning(true);
        ContextCompat.registerReceiver(this, batteryWatch, new IntentFilter(Intent.ACTION_BATTERY_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED);
        locations = (LocationManager) getSystemService(LOCATION_SERVICE);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // The default (balanced) quality skips GPS and gives nothing where network location is off or weak.
                LocationRequest request = new LocationRequest.Builder(INTERVAL_MS).setQuality(LocationRequest.QUALITY_HIGH_ACCURACY).build();
                locations.requestLocationUpdates(provider(), request, ContextCompat.getMainExecutor(this), listener);
            } else {
                locations.requestLocationUpdates(provider(), INTERVAL_MS, 0f, listener, Looper.getMainLooper());
            }
        } catch (SecurityException | IllegalArgumentException e) {
            shutdown("permission");
            return START_NOT_STICKY;
        }
        network.execute(() -> request("PUT", "/api/location/sharing", "{\"on\":true}"));
        // Not sticky: after the system kills it, sharing stays off until it is turned on again in the app.
        return START_NOT_STICKY;
    }

    private boolean hasPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private String provider() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && locations.hasProvider(LocationManager.FUSED_PROVIDER)) return LocationManager.FUSED_PROVIDER;
        if (locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) return LocationManager.GPS_PROVIDER;
        return LocationManager.NETWORK_PROVIDER;
    }

    private void send(Location location) {
        String body = String.format(Locale.US, "{\"lat\":%.6f,\"lng\":%.6f,\"accuracy\":%.1f,\"at\":%d}",
            location.getLatitude(), location.getLongitude(), location.hasAccuracy() ? location.getAccuracy() : 100f, location.getTime());
        // Only the newest point matters: a failed one is simply replaced by the next.
        network.execute(() -> {
            if (request("POST", "/api/location/point", body) == 401) {
                alert("Đăng nhập lại để tiếp tục chia sẻ vị trí.");
                shutdown("auth");
            }
        });
    }

    /** Status code, or -1 when the request did not complete. Runs on the network thread. */
    private int request(String method, String path, String json) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(serverUrl + path).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Origin", serverUrl);
            connection.setRequestProperty("X-Requested-With", "Homie");
            String cookie = CookieManager.getInstance().getCookie(serverUrl);
            if (cookie != null) connection.setRequestProperty("Cookie", cookie);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
            }
            return connection.getResponseCode();
        } catch (Exception e) {
            return -1;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private synchronized void shutdown(String reason) {
        if (stopping) return;
        stopping = true;
        if (locations != null) locations.removeUpdates(listener);
        try { unregisterReceiver(batteryWatch); } catch (IllegalArgumentException ignored) { }
        setRunning(false);
        if (serverUrl == null) serverUrl = getSharedPreferences(PREFS, MODE_PRIVATE).getString("server", null);
        if (serverUrl != null && !"auth".equals(reason)) {
            network.execute(() -> request("PUT", "/api/location/sharing", "{\"on\":false,\"reason\":\"" + reason + "\"}"));
        }
        network.execute(() -> {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
        });
    }

    @Override
    public void onDestroy() {
        if (!stopping && locations != null) locations.removeUpdates(listener);
        setRunning(false);
        network.shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void channels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Chia sẻ vị trí", NotificationManager.IMPORTANCE_LOW));
        manager.createNotificationChannel(new NotificationChannel(ALERTS, "Chia sẻ vị trí đã tắt", NotificationManager.IMPORTANCE_DEFAULT));
    }

    private PendingIntent openApp() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification ongoing() {
        channels();
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, LocationService.class).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_homie)
            .setContentTitle("Homie đang chia sẻ vị trí")
            .setContentText("Khoảng 2 phút một lần. Tự tắt khi pin dưới 20%.")
            .setOngoing(true)
            .setContentIntent(openApp())
            .addAction(0, "Dừng chia sẻ", stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void alert(String text) {
        channels();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Notification notification = new NotificationCompat.Builder(this, ALERTS)
            .setSmallIcon(R.drawable.ic_stat_homie)
            .setContentTitle("Homie")
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(openApp())
            .build();
        getSystemService(NotificationManager.class).notify(ALERT_ID, notification);
    }
}

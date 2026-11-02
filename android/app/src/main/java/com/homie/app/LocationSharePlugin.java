package com.homie.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Vị trí: starts and stops LocationService, which shares the phone's position about every 2 minutes in the background.
 * The page (js/features/location/share.js) asks for permissions first and warns about battery use.
 */
@CapacitorPlugin(
    name = "LocationShare",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class LocationSharePlugin extends Plugin {
    /** { running, permission, battery, charging, ignoringBatteryOptimizations, manufacturer } */
    @PluginMethod
    public void status(PluginCall call) {
        Context context = getContext();
        BatteryManager battery = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        JSObject result = new JSObject();
        result.put("running", LocationService.isRunning(context));
        result.put("permission", getPermissionState("location").toString());
        result.put("battery", battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY));
        result.put("charging", battery.isCharging());
        result.put("ignoringBatteryOptimizations", power.isIgnoringBatteryOptimizations(context.getPackageName()));
        result.put("manufacturer", Build.MANUFACTURER);
        call.resolve(result);
    }

    /** start({ serverUrl }): the site the WebView loads, whose session cookie the service sends. */
    @PluginMethod
    public void start(PluginCall call) {
        String serverUrl = call.getString("serverUrl", "");
        Uri url = Uri.parse(serverUrl);
        boolean local = "localhost".equals(url.getHost()) || "127.0.0.1".equals(url.getHost());
        if (!"https".equals(url.getScheme()) && !local) {
            call.reject("serverUrl must be https");
            return;
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission is required");
            return;
        }
        if (LocationService.batteryTooLow(getContext())) {
            call.reject("Battery below 20%");
            return;
        }
        Intent intent = new Intent(getContext(), LocationService.class)
            .setAction(LocationService.ACTION_START)
            .putExtra(LocationService.EXTRA_SERVER, serverUrl.replaceAll("/+$", ""));
        ContextCompat.startForegroundService(getContext(), intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (LocationService.isRunning(getContext())) {
            getContext().startService(new Intent(getContext(), LocationService.class).setAction(LocationService.ACTION_STOP));
        }
        call.resolve();
    }

    /** The system dialog that lets Homie run without battery optimisation. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
        open(call, intent);
    }

    /** Homie's own settings page (permissions, battery, autostart on some phones). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        open(call, intent);
    }

    private void open(PluginCall call, Intent intent) {
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Settings unavailable");
        }
    }
}

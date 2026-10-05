package cz.explore.permissions;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.PermissionInfo;
import android.database.Cursor;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.provider.MediaStore;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Native-only capabilities that a web app / PWA cannot have:
 * listing installed apps and all declared permissions, reading the clipboard via the Android API
 * (incl. from the background), shared storage / media, contacts, calendar, sensors, Bluetooth and Wi-Fi.
 */
@CapacitorPlugin(
    name = "DeviceInsights",
    permissions = {
        // Media: one alias per Android version range, the right one is picked at runtime (see mediaAlias()).
        @Permission(alias = "mediaLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "media33", strings = { Manifest.permission.READ_MEDIA_IMAGES }),
        @Permission(
            alias = "media34",
            strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }
        ),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
        @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR }),
        // Android 10+ (API 29), before that the step counter needs no permission.
        @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }),
        // Android 12+ (API 31), before that Bluetooth uses the normal BLUETOOTH permission.
        @Permission(alias = "nearby", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }),
        // Android 13+ (API 33), before that notifications are allowed by default.
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class DeviceInsightsPlugin extends Plugin {

    private volatile boolean inForeground = true;

    @Override
    protected void handleOnResume() {
        inForeground = true;
    }

    @Override
    protected void handleOnPause() {
        inForeground = false;
    }

    // ---------- All permissions ----------

    @PluginMethod
    public void getAllPermissions(PluginCall call) {
        call.resolve(allPermissions());
    }

    /** Asks for every runtime permission at once – shows how annoying "permission fatigue" is. */
    @PluginMethod
    public void requestAllPermissions(PluginCall call) {
        List<String> aliases = new ArrayList<>(Arrays.asList("location", "camera", "microphone", "contacts", "calendar", mediaAlias()));
        if (Build.VERSION.SDK_INT >= 29) aliases.add("activity");
        if (Build.VERSION.SDK_INT >= 31) aliases.add("nearby");
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "allPermissionsCallback");
    }

    @PermissionCallback
    private void allPermissionsCallback(PluginCall call) {
        call.resolve(allPermissions());
    }

    private JSObject allPermissions() {
        PackageManager pm = getContext().getPackageManager();
        JSArray list = new JSArray();
        try {
            PackageInfo info = pm.getPackageInfo(getContext().getPackageName(), PackageManager.GET_PERMISSIONS);
            for (int i = 0; info.requestedPermissions != null && i < info.requestedPermissions.length; i++) {
                String name = info.requestedPermissions[i];
                JSObject o = new JSObject();
                o.put("name", name);
                o.put("granted", (info.requestedPermissionsFlags[i] & PackageInfo.REQUESTED_PERMISSION_GRANTED) != 0);
                o.put("level", protectionLevel(pm, name));
                list.put(o);
            }
        } catch (PackageManager.NameNotFoundException e) {
            // Cannot happen for our own package.
        }
        JSObject ret = new JSObject();
        ret.put("permissions", list);
        ret.put("allFilesAccess", Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager());
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        return ret;
    }

    private static String protectionLevel(PackageManager pm, String name) {
        try {
            PermissionInfo p = pm.getPermissionInfo(name, 0);
            if ((p.protectionLevel & PermissionInfo.PROTECTION_FLAG_APPOP) != 0) return "special";
            int base = Build.VERSION.SDK_INT >= 28 ? p.getProtection() : p.protectionLevel & PermissionInfo.PROTECTION_MASK_BASE;
            switch (base) {
                case PermissionInfo.PROTECTION_NORMAL:
                    return "normal";
                case PermissionInfo.PROTECTION_DANGEROUS:
                    return "runtime";
                case PermissionInfo.PROTECTION_SIGNATURE:
                    return "signature";
                default:
                    return "internal";
            }
        } catch (PackageManager.NameNotFoundException e) {
            // E.g. a permission that does not exist on this Android version yet.
            return "unknown";
        }
    }

    // ---------- Installed apps ----------

    @PluginMethod
    public void getInstalledApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        // Subject to package visibility filtering on Android 11+ (see <queries> in AndroidManifest.xml).
        List<ApplicationInfo> apps = pm.getInstalledApplications(0);
        apps.sort((a, b) -> pm.getApplicationLabel(a).toString().compareToIgnoreCase(pm.getApplicationLabel(b).toString()));

        JSArray list = new JSArray();
        for (ApplicationInfo app : apps) {
            JSObject o = new JSObject();
            o.put("packageName", app.packageName);
            o.put("label", pm.getApplicationLabel(app).toString());
            o.put("system", (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
            list.put(o);
        }

        JSObject ret = new JSObject();
        ret.put("apps", list);
        ret.put("queryAllPackages", declaresPermission(Manifest.permission.QUERY_ALL_PACKAGES));
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    @PluginMethod
    public void isInstalled(PluginCall call) {
        String packageName = call.getString("packageName");
        if (packageName == null) {
            call.reject("packageName is required");
            return;
        }
        boolean installed;
        try {
            getContext().getPackageManager().getPackageInfo(packageName, 0);
            installed = true;
        } catch (PackageManager.NameNotFoundException e) {
            // Either really not installed, or hidden from us by package visibility rules.
            installed = false;
        }
        JSObject ret = new JSObject();
        ret.put("packageName", packageName);
        ret.put("installed", installed);
        call.resolve(ret);
    }

    // ---------- Clipboard ----------

    @PluginMethod
    public void readClipboard(PluginCall call) {
        call.resolve(readClipboardNow());
    }

    @PluginMethod
    public void readClipboardDelayed(PluginCall call) {
        int delayMs = call.getInt("delayMs", 3000);
        new Handler(Looper.getMainLooper()).postDelayed(() -> call.resolve(readClipboardNow()), delayMs);
    }

    private JSObject readClipboardNow() {
        ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        // Android 10+: returns null when the app is not in the foreground (and is not the default keyboard).
        ClipData clip = cm.getPrimaryClip();
        String text = null;
        if (clip != null && clip.getItemCount() > 0) {
            CharSequence cs = clip.getItemAt(0).coerceToText(getContext());
            text = cs != null ? cs.toString() : null;
        }
        JSObject ret = new JSObject();
        ret.put("text", text);
        ret.put("readInForeground", inForeground);
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        return ret;
    }

    // ---------- Storage / media ----------

    @PluginMethod
    public void getStorageStatus(PluginCall call) {
        call.resolve(storageStatus());
    }

    @PluginMethod
    public void requestMediaAccess(PluginCall call) {
        requestPermissionForAlias(mediaAlias(), call, "mediaAccessCallback");
    }

    @PermissionCallback
    private void mediaAccessCallback(PluginCall call) {
        call.resolve(storageStatus());
    }

    private static String mediaAlias() {
        return Build.VERSION.SDK_INT >= 34 ? "media34" : Build.VERSION.SDK_INT >= 33 ? "media33" : "mediaLegacy";
    }

    private JSObject storageStatus() {
        String photos;
        if (Build.VERSION.SDK_INT >= 33 && isGranted(Manifest.permission.READ_MEDIA_IMAGES)) {
            photos = "full";
        } else if (Build.VERSION.SDK_INT >= 34 && isGranted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)) {
            // Android 14+: the user picked "Select photos" and we only see those.
            photos = "partial";
        } else if (Build.VERSION.SDK_INT < 33 && isGranted(Manifest.permission.READ_EXTERNAL_STORAGE)) {
            photos = "full";
        } else {
            photos = "denied";
        }

        JSObject ret = new JSObject();
        ret.put("photos", photos);
        // How many images MediaStore lets us see: everything, only the selected ones, or just our own.
        ret.put("visibleImages", count(MediaStore.Images.Media.EXTERNAL_CONTENT_URI));
        ret.put("manageExternalStorageDeclared", declaresPermission("android.permission.MANAGE_EXTERNAL_STORAGE"));
        ret.put("allFilesAccess", Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager());
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        return ret;
    }

    // ---------- Contacts & calendar ----------

    @PluginMethod
    public void readContacts(PluginCall call) {
        if (isGranted(Manifest.permission.READ_CONTACTS)) {
            call.resolve(contacts());
        } else {
            requestPermissionForAlias("contacts", call, "contactsCallback");
        }
    }

    @PermissionCallback
    private void contactsCallback(PluginCall call) {
        if (isGranted(Manifest.permission.READ_CONTACTS)) call.resolve(contacts());
        else call.reject("Oprávnění READ_CONTACTS zamítnuto");
    }

    private JSObject contacts() {
        JSObject ret = new JSObject();
        String name = ContactsContract.Contacts.DISPLAY_NAME_PRIMARY;
        try (Cursor c = resolver().query(ContactsContract.Contacts.CONTENT_URI, new String[] { name }, null, null, name + " ASC")) {
            ret.put("count", c != null ? c.getCount() : 0);
            JSArray sample = new JSArray();
            while (c != null && c.moveToNext() && sample.length() < 5) {
                // Masked, so the demo can run on a projector without leaking real names.
                sample.put(mask(c.getString(0)));
            }
            ret.put("sample", sample);
        }
        return ret;
    }

    @PluginMethod
    public void readCalendar(PluginCall call) {
        if (isGranted(Manifest.permission.READ_CALENDAR)) {
            call.resolve(calendar());
        } else {
            requestPermissionForAlias("calendar", call, "calendarCallback");
        }
    }

    @PermissionCallback
    private void calendarCallback(PluginCall call) {
        if (isGranted(Manifest.permission.READ_CALENDAR)) call.resolve(calendar());
        else call.reject("Oprávnění READ_CALENDAR zamítnuto");
    }

    private JSObject calendar() {
        JSObject ret = new JSObject();
        ret.put("events", count(CalendarContract.Events.CONTENT_URI));
        // Calendar accounts are usually e-mail addresses – one more thing this permission reveals.
        Set<String> accounts = new LinkedHashSet<>();
        try (
            Cursor c = resolver().query(CalendarContract.Calendars.CONTENT_URI, new String[] { CalendarContract.Calendars.ACCOUNT_NAME }, null, null, null)
        ) {
            while (c != null && c.moveToNext()) accounts.add(mask(c.getString(0)));
        }
        ret.put("accounts", new JSArray(accounts));
        return ret;
    }

    // ---------- Sensors ----------

    @PluginMethod
    public void getSensors(PluginCall call) {
        // Listing sensors needs no permission at all.
        JSArray list = new JSArray();
        for (Sensor s : sensorManager().getSensorList(Sensor.TYPE_ALL)) {
            JSObject o = new JSObject();
            o.put("name", s.getName());
            o.put("type", s.getStringType().replace("android.sensor.", ""));
            o.put("vendor", s.getVendor());
            list.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("sensors", list);
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /** Listens to every sensor at once for a while and returns the last value of each – still without any permission. */
    @PluginMethod
    public void measureAllSensors(PluginCall call) {
        int durationMs = call.getInt("durationMs", 3000);
        SensorManager sm = sensorManager();
        Map<Sensor, float[]> last = new LinkedHashMap<>();
        Map<Sensor, Integer> counts = new LinkedHashMap<>();
        Map<Sensor, String> status = new LinkedHashMap<>();
        SensorEventListener listener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                last.put(event.sensor, event.values.clone());
                counts.merge(event.sensor, 1, Integer::sum);
            }

            @Override
            public void onAccuracyChanged(Sensor sensor, int accuracy) {}
        };
        Handler main = new Handler(Looper.getMainLooper());
        List<Sensor> sensors = sm.getSensorList(Sensor.TYPE_ALL);
        for (Sensor s : sensors) {
            if (s.getReportingMode() == Sensor.REPORTING_MODE_ONE_SHOT) {
                // Gestures like significant motion fire once per event and need requestTriggerSensor().
                status.put(s, "one-shot");
            } else if (!sm.registerListener(listener, s, SensorManager.SENSOR_DELAY_NORMAL, main)) {
                // E.g. the step counter without ACTIVITY_RECOGNITION.
                status.put(s, "refused");
            }
        }
        main.postDelayed(
            () -> {
                sm.unregisterListener(listener);
                JSArray list = new JSArray();
                for (Sensor s : sensors) {
                    JSObject o = new JSObject();
                    o.put("name", s.getName());
                    o.put("type", s.getStringType().replace("android.sensor.", ""));
                    JSArray values = new JSArray();
                    float[] v = last.get(s);
                    // JSON has no NaN / Infinity.
                    for (int i = 0; v != null && i < v.length; i++) values.put(Float.isFinite(v[i]) ? v[i] : null);
                    o.put("values", values);
                    o.put("events", counts.getOrDefault(s, 0));
                    o.put("status", status.getOrDefault(s, v != null ? "ok" : "silent"));
                    list.put(o);
                }
                JSObject ret = new JSObject();
                ret.put("sensors", list);
                call.resolve(ret);
            },
            durationMs
        );
    }

    @PluginMethod
    public void readSteps(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 29 && !isGranted(Manifest.permission.ACTIVITY_RECOGNITION)) {
            requestPermissionForAlias("activity", call, "stepsCallback");
        } else {
            readStepsNow(call);
        }
    }

    @PermissionCallback
    private void stepsCallback(PluginCall call) {
        if (isGranted(Manifest.permission.ACTIVITY_RECOGNITION)) readStepsNow(call);
        else call.reject("Oprávnění ACTIVITY_RECOGNITION zamítnuto");
    }

    private void readStepsNow(PluginCall call) {
        SensorManager sm = sensorManager();
        Sensor counter = sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (counter == null) {
            call.reject("Zařízení nemá krokoměr");
            return;
        }
        AtomicBoolean done = new AtomicBoolean(false);
        SensorEventListener listener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                if (!done.compareAndSet(false, true)) return;
                sm.unregisterListener(this);
                JSObject ret = new JSObject();
                ret.put("stepsSinceReboot", (long) event.values[0]);
                call.resolve(ret);
            }

            @Override
            public void onAccuracyChanged(Sensor sensor, int accuracy) {}
        };
        sm.registerListener(listener, counter, SensorManager.SENSOR_DELAY_NORMAL);
        // The counter only reports on change; give up if nothing arrives.
        new Handler(Looper.getMainLooper()).postDelayed(
            () -> {
                if (!done.compareAndSet(false, true)) return;
                sm.unregisterListener(listener);
                call.reject("Krokoměr nic nenahlásil – zkuste udělat pár kroků");
            },
            5000
        );
    }

    // ---------- Notifications ----------

    // The Android WebView has no web Notification API, so the native app posts them itself.
    @PluginMethod
    public void showNotification(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && !isGranted(Manifest.permission.POST_NOTIFICATIONS)) {
            requestPermissionForAlias("notifications", call, "notificationCallback");
        } else {
            showNotificationNow(call);
        }
    }

    @PermissionCallback
    private void notificationCallback(PluginCall call) {
        if (isGranted(Manifest.permission.POST_NOTIFICATIONS)) showNotificationNow(call);
        else call.reject("Oprávnění POST_NOTIFICATIONS zamítnuto");
    }

    @SuppressLint("MissingPermission") // checked in showNotification()
    private void showNotificationNow(PluginCall call) {
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        String channelId = "demo";
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(channelId, "Ukázka", NotificationManager.IMPORTANCE_DEFAULT));
        }
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), channelId)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(0xFF1F6FEB) // brand blue, tints the icon in the notification shade
            .setContentTitle(call.getString("title", "Permission Explorer"))
            .setContentText(call.getString("body", ""))
            .setAutoCancel(true);
        nm.notify((int) System.currentTimeMillis(), builder.build());

        JSObject ret = new JSObject();
        // The user can still switch notifications off per app (or per channel) in Settings.
        ret.put("enabled", nm.areNotificationsEnabled());
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    // ---------- Nearby devices ----------

    @PluginMethod
    public void getBluetoothDevices(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 31 && !isGranted(Manifest.permission.BLUETOOTH_CONNECT)) {
            requestPermissionForAlias("nearby", call, "bluetoothCallback");
        } else {
            bluetoothDevices(call);
        }
    }

    @PermissionCallback
    private void bluetoothCallback(PluginCall call) {
        if (isGranted(Manifest.permission.BLUETOOTH_CONNECT)) bluetoothDevices(call);
        else call.reject("Oprávnění BLUETOOTH_CONNECT zamítnuto");
    }

    @SuppressLint("MissingPermission") // checked in getBluetoothDevices()
    private void bluetoothDevices(PluginCall call) {
        BluetoothManager bm = getContext().getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = bm != null ? bm.getAdapter() : null;
        if (adapter == null) {
            call.reject("Zařízení nemá Bluetooth");
            return;
        }
        JSArray paired = new JSArray();
        for (BluetoothDevice d : adapter.getBondedDevices()) paired.put(d.getName());
        JSObject ret = new JSObject();
        ret.put("enabled", adapter.isEnabled());
        ret.put("paired", paired);
        call.resolve(ret);
    }

    @PluginMethod
    public void getWifiInfo(PluginCall call) {
        if (call.getBoolean("requestLocation", false) && !isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            requestPermissionForAlias("location", call, "wifiCallback");
        } else {
            call.resolve(wifiInfo());
        }
    }

    @PermissionCallback
    private void wifiCallback(PluginCall call) {
        call.resolve(wifiInfo());
    }

    @SuppressWarnings("deprecation") // getConnectionInfo() still works and keeps the demo short
    private JSObject wifiInfo() {
        WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiInfo info = wm.getConnectionInfo();
        JSObject ret = new JSObject();
        // Without location permission Android returns "<unknown ssid>": the network name reveals where you are.
        ret.put("ssid", info != null ? info.getSSID() : null);
        ret.put("locationGranted", isGranted(Manifest.permission.ACCESS_FINE_LOCATION));
        ret.put("wifiEnabled", wm.isWifiEnabled());
        return ret;
    }

    // ---------- Device identity: IP, MAC, OS ----------

    /** Everything here works without any runtime permission (only normal INTERNET / ACCESS_WIFI_STATE). */
    @PluginMethod
    @SuppressWarnings("deprecation") // WifiInfo.getMacAddress() – kept on purpose to show it is blanked out
    @SuppressLint("HardwareIds")
    public void getDeviceIdentity(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("manufacturer", Build.MANUFACTURER);
        ret.put("model", Build.MODEL);
        ret.put("androidVersion", Build.VERSION.RELEASE);
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        ret.put("securityPatch", Build.VERSION.SECURITY_PATCH);
        // The replacement for hardware IDs since Android 8: unique per app signing key + user + device.
        ret.put("androidId", Settings.Secure.getString(resolver(), Settings.Secure.ANDROID_ID));

        // Since Android 6 this is always the fake 02:00:00:00:00:00.
        WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiInfo info = wm.getConnectionInfo();
        ret.put("wifiMac", info != null ? info.getMacAddress() : null);

        JSArray interfaces = new JSArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                JSArray ips = new JSArray();
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    String ip = a.getHostAddress();
                    ips.put(ip != null && ip.contains("%") ? ip.substring(0, ip.indexOf('%')) : ip);
                }
                JSObject o = new JSObject();
                o.put("name", ni.getName());
                o.put("ips", ips);
                // Android 11+ returns null for apps targeting API 30+, older versions a fake address.
                o.put("mac", macOf(ni));
                interfaces.put(o);
            }
        } catch (Exception e) {
            ret.put("interfacesError", e.toString());
        }
        ret.put("interfaces", interfaces);
        call.resolve(ret);
    }

    private static String macOf(NetworkInterface ni) {
        byte[] mac;
        try {
            mac = ni.getHardwareAddress();
        } catch (Exception e) {
            return null;
        }
        if (mac == null) return null;
        StringBuilder sb = new StringBuilder();
        for (byte b : mac) sb.append(sb.length() > 0 ? ":" : "").append(String.format("%02x", b));
        return sb.toString();
    }

    // ---------- Helpers ----------

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    private SensorManager sensorManager() {
        return (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
    }

    private int count(android.net.Uri uri) {
        try (Cursor c = resolver().query(uri, null, null, null, null)) {
            return c != null ? c.getCount() : 0;
        } catch (SecurityException e) {
            return 0;
        }
    }

    /** "Jan Novák" -> "J** N****", "jan@example.com" -> "j**@example.com". */
    private static String mask(String s) {
        if (s == null) return null;
        StringBuilder out = new StringBuilder();
        boolean wordStart = true;
        boolean domain = false;
        for (char ch : s.toCharArray()) {
            if (ch == '@') domain = true;
            boolean letter = Character.isLetterOrDigit(ch);
            out.append(domain || !letter || wordStart ? ch : '*');
            wordStart = !letter;
        }
        return out.toString();
    }

    private boolean isGranted(String permission) {
        return getContext().checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean declaresPermission(String permission) {
        try {
            PackageInfo info = getContext()
                .getPackageManager()
                .getPackageInfo(getContext().getPackageName(), PackageManager.GET_PERMISSIONS);
            return info.requestedPermissions != null && Arrays.asList(info.requestedPermissions).contains(permission);
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}

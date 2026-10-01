package cz.explore.permissions;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Arrays;
import java.util.List;

/**
 * Native-only capabilities that a web app / PWA cannot have:
 * listing installed apps, reading the clipboard via the Android API (incl. from the background)
 * and checking access to shared storage / media.
 */
@CapacitorPlugin(
    name = "DeviceInsights",
    permissions = {
        // One alias per Android version range, the right one is picked at runtime in requestMediaAccess().
        @Permission(alias = "mediaLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "media33", strings = { Manifest.permission.READ_MEDIA_IMAGES }),
        @Permission(
            alias = "media34",
            strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }
        ),
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

    @PluginMethod
    public void readClipboard(PluginCall call) {
        call.resolve(readClipboardNow());
    }

    @PluginMethod
    public void readClipboardDelayed(PluginCall call) {
        int delayMs = call.getInt("delayMs", 5000);
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

    @PluginMethod
    public void getStorageStatus(PluginCall call) {
        call.resolve(storageStatus());
    }

    @PluginMethod
    public void requestMediaAccess(PluginCall call) {
        String alias = Build.VERSION.SDK_INT >= 34 ? "media34" : Build.VERSION.SDK_INT >= 33 ? "media33" : "mediaLegacy";
        requestPermissionForAlias(alias, call, "mediaAccessCallback");
    }

    @PermissionCallback
    private void mediaAccessCallback(PluginCall call) {
        call.resolve(storageStatus());
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
        ret.put("visibleImages", countImages());
        ret.put("manageExternalStorageDeclared", declaresPermission("android.permission.MANAGE_EXTERNAL_STORAGE"));
        ret.put("allFilesAccess", Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager());
        ret.put("sdkInt", Build.VERSION.SDK_INT);
        return ret;
    }

    private int countImages() {
        try (
            Cursor c = getContext()
                .getContentResolver()
                .query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, new String[] { MediaStore.Images.Media._ID }, null, null, null)
        ) {
            return c != null ? c.getCount() : 0;
        } catch (SecurityException e) {
            return 0;
        }
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

package com.aayat.assistant;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.AlarmClock;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.telephony.SmsManager;
import android.text.TextUtils;
import android.view.KeyEvent;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(
    name = "DeviceControl",
    permissions = {
        @Permission(alias = "phone", strings = { Manifest.permission.CALL_PHONE }),
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }),
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class DeviceControlPlugin extends Plugin {

    static DeviceControlPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    // ─── Events to JS ───────────────────────────────────────────────────
    void emitWake(String rest) {
        JSObject d = new JSObject();
        d.put("heard", rest == null ? "" : rest);
        notifyListeners("wake", d);
    }

    void emitNotification(MyraNotificationService.Item it) {
        JSObject d = new JSObject();
        d.put("app", it.app);
        d.put("pkg", it.pkg);
        d.put("title", it.title);
        d.put("text", it.text);
        d.put("category", it.category == null ? "" : it.category);
        notifyListeners("notification", d);
    }

    // ─── Wake word ──────────────────────────────────────────────────────
    @PluginMethod
    public void startWakeListener(PluginCall call) {
        MainActivity act = (MainActivity) getActivity();
        if (act == null || act.wake == null) { call.reject("no activity"); return; }
        JSArray arr = call.getArray("words", null);
        if (arr != null) {
            try {
                java.util.List<String> list = arr.toList();
                act.wake.setWords(list.toArray(new String[0]));
            } catch (Exception ignored) {}
        }
        if (!granted("microphone")) { requestPermissionForAlias("microphone", call, "wakePermCallback"); return; }
        boolean ok = act.wake.start();
        if (ok) call.resolve(); else call.reject("Speech recognition not available");
    }

    @PermissionCallback
    private void wakePermCallback(PluginCall call) {
        MainActivity act = (MainActivity) getActivity();
        if (act != null && act.wake != null && act.wake.start()) call.resolve();
        else call.reject("Microphone permission denied");
    }

    @PluginMethod
    public void stopWakeListener(PluginCall call) {
        MainActivity act = (MainActivity) getActivity();
        if (act != null && act.wake != null) act.wake.stop();
        call.resolve();
    }

    // ─── Smart alarm: AlarmManager se app ko time par khol do ───────────
    @PluginMethod
    public void scheduleWake(PluginCall call) {
        String id = call.getString("id", "0");
        int hour = call.getInt("hour", 0);
        int minute = call.getInt("minute", 0);
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            Intent i = new Intent(getContext(), AlarmReceiver.class);
            i.setAction("com.aayat.assistant.WAKE." + id);
            android.app.PendingIntent pi = android.app.PendingIntent.getBroadcast(
                    getContext(), id.hashCode(), i,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            java.util.Calendar c = java.util.Calendar.getInstance();
            c.set(java.util.Calendar.HOUR_OF_DAY, hour);
            c.set(java.util.Calendar.MINUTE, minute);
            c.set(java.util.Calendar.SECOND, 0);
            if (c.getTimeInMillis() <= System.currentTimeMillis()) c.add(java.util.Calendar.DAY_OF_MONTH, 1);
            if (android.os.Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), pi);
            } else {
                am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), pi);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not schedule: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelWake(PluginCall call) {
        String id = call.getString("id", "0");
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            Intent i = new Intent(getContext(), AlarmReceiver.class);
            i.setAction("com.aayat.assistant.WAKE." + id);
            android.app.PendingIntent pi = android.app.PendingIntent.getBroadcast(
                    getContext(), id.hashCode(), i,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            am.cancel(pi);
            call.resolve();
        } catch (Exception e) { call.resolve(); }
    }

    // ─── Notification access ────────────────────────────────────────────
    @PluginMethod
    public void notificationAccessStatus(PluginCall call) {
        String flat = Settings.Secure.getString(getContext().getContentResolver(), "enabled_notification_listeners");
        boolean on = flat != null && flat.contains(getContext().getPackageName());
        JSObject r = new JSObject();
        r.put("enabled", on);
        call.resolve(r);
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        try {
            start(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"));
            call.resolve();
        } catch (Exception e) { call.reject("Could not open settings"); }
    }

    @PluginMethod
    public void getNotifications(PluginCall call) {
        MyraNotificationService svc = MyraNotificationService.instance;
        if (svc == null) { call.reject("ACCESS_OFF"); return; }
        JSArray items = new JSArray();
        for (MyraNotificationService.Item it : svc.list(call.getString("app"), Math.min(10, call.getInt("limit", 5)))) {
            JSObject o = new JSObject();
            o.put("key", it.key); o.put("app", it.app); o.put("title", it.title);
            o.put("text", it.text); o.put("time", it.time); o.put("category", it.category == null ? "" : it.category);
            items.put(o);
        }
        JSObject r = new JSObject();
        r.put("items", items);
        call.resolve(r);
    }

    @PluginMethod
    public void replyNotification(PluginCall call) {
        MyraNotificationService svc = MyraNotificationService.instance;
        if (svc == null) { call.reject("ACCESS_OFF"); return; }
        String match = call.getString("match", "");
        boolean sent = svc.reply(match, call.getString("message", ""));
        JSObject r = new JSObject();
        r.put("sent", sent);
        r.put("title", svc.titleOf(match));
        call.resolve(r);
    }


    private boolean granted(String alias) {
        return getPermissionState(alias) == PermissionState.GRANTED;
    }

    private void start(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }

    // ─── Calls ──────────────────────────────────────────────────────────
    @PluginMethod
    public void call(PluginCall call) {
        if (TextUtils.isEmpty(call.getString("number"))) { call.reject("number required"); return; }
        if (!granted("phone")) { requestPermissionForAlias("phone", call, "callPermCallback"); return; }
        doCall(call);
    }

    @PermissionCallback
    private void callPermCallback(PluginCall call) { doCall(call); }

    private void doCall(PluginCall call) {
        boolean direct = granted("phone");
        String number = call.getString("number");
        try {
            start(new Intent(direct ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number))));
            JSObject r = new JSObject();
            r.put("direct", direct);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not start call: " + e.getMessage());
        }
    }

    // ─── SMS ────────────────────────────────────────────────────────────
    @PluginMethod
    public void sendSms(PluginCall call) {
        if (TextUtils.isEmpty(call.getString("number"))) { call.reject("number required"); return; }
        if (!granted("sms")) { requestPermissionForAlias("sms", call, "smsPermCallback"); return; }
        doSms(call);
    }

    @PermissionCallback
    private void smsPermCallback(PluginCall call) { doSms(call); }

    @SuppressWarnings("deprecation")
    private void doSms(PluginCall call) {
        String number = call.getString("number");
        String message = call.getString("message", "");
        try {
            JSObject r = new JSObject();
            if (granted("sms")) {
                SmsManager sm = Build.VERSION.SDK_INT >= 31
                    ? getContext().getSystemService(SmsManager.class)
                    : SmsManager.getDefault();
                ArrayList<String> parts = sm.divideMessage(message);
                sm.sendMultipartTextMessage(number, null, parts, null, null);
                r.put("direct", true);
            } else {
                Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(number)));
                i.putExtra("sms_body", message);
                start(i);
                r.put("direct", false);
            }
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not send SMS: " + e.getMessage());
        }
    }

    // ─── WhatsApp (auto-send via accessibility) ─────────────────────────
    @PluginMethod
    public void sendWhatsApp(PluginCall call) {
        String number = call.getString("number", "");
        String message = call.getString("message", "");
        boolean wantAuto = Boolean.TRUE.equals(call.getBoolean("autoSend", true));
        Uri uri = Uri.parse("https://api.whatsapp.com/send?phone=" + Uri.encode(number) + "&text=" + Uri.encode(message));
        boolean auto = wantAuto && isAccessibilityOn();

        String[] pkgs = { "com.whatsapp", "com.whatsapp.w4b" };
        try {
            for (String pkg : pkgs) {
                if (!isInstalled(pkg)) continue;
                Intent i = new Intent(Intent.ACTION_VIEW, uri);
                i.setPackage(pkg);
                if (auto) AutoSendService.arm();
                start(i);
                JSObject r = new JSObject();
                r.put("installed", true);
                r.put("autoSend", auto);
                call.resolve(r);
                return;
            }
            start(new Intent(Intent.ACTION_VIEW, uri));
            JSObject r = new JSObject();
            r.put("installed", false);
            r.put("autoSend", false);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not open WhatsApp: " + e.getMessage());
        }
    }

    private boolean isInstalled(String pkg) {
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    // ─── Contacts ───────────────────────────────────────────────────────
    @PluginMethod
    public void getContacts(PluginCall call) {
        if (!granted("contacts")) { requestPermissionForAlias("contacts", call, "contactsPermCallback"); return; }
        readContacts(call);
    }

    @PermissionCallback
    private void contactsPermCallback(PluginCall call) {
        if (!granted("contacts")) { call.reject("Contacts permission denied"); return; }
        readContacts(call);
    }

    private void readContacts(PluginCall call) {
        new Thread(() -> {
            JSArray arr = new JSArray();
            HashSet<String> seen = new HashSet<>();
            String[] cols = {
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            };
            try (Cursor c = getContext().getContentResolver().query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI, cols, null, null,
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC")) {
                if (c != null) {
                    while (c.moveToNext()) {
                        String name = c.getString(0);
                        String num = c.getString(1);
                        if (name == null || num == null) continue;
                        if (!seen.add(name.toLowerCase(Locale.ROOT))) continue;
                        JSObject o = new JSObject();
                        o.put("name", name);
                        o.put("phone", num);
                        arr.put(o);
                    }
                }
                JSObject r = new JSObject();
                r.put("contacts", arr);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not read contacts: " + e.getMessage());
            }
        }).start();
    }

    // ─── Apps ───────────────────────────────────────────────────────────
    private List<ResolveInfo> launcherApps() {
        Intent main = new Intent(Intent.ACTION_MAIN);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        return getContext().getPackageManager().queryIntentActivities(main, 0);
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String name = call.getString("name", "").toLowerCase(Locale.ROOT).trim();
        PackageManager pm = getContext().getPackageManager();
        ResolveInfo best = null;
        int bestScore = 0;
        for (ResolveInfo ri : launcherApps()) {
            String label = ri.loadLabel(pm).toString().toLowerCase(Locale.ROOT);
            String pkg = ri.activityInfo.packageName.toLowerCase(Locale.ROOT);
            int s = label.equals(name) ? 100
                : label.startsWith(name) ? 80
                : (label.contains(name) || name.contains(label)) ? 60
                : pkg.contains(name.replace(" ", "")) ? 40 : 0;
            if (s > bestScore) { bestScore = s; best = ri; }
        }
        JSObject r = new JSObject();
        if (best == null || name.isEmpty()) {
            r.put("opened", false);
            call.resolve(r);
            return;
        }
        Intent li = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
        if (li == null) {
            li = new Intent(Intent.ACTION_MAIN);
            li.addCategory(Intent.CATEGORY_LAUNCHER);
            li.setComponent(new ComponentName(best.activityInfo.packageName, best.activityInfo.name));
        }
        try {
            start(li);
            r.put("opened", true);
            r.put("label", best.loadLabel(pm).toString());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Could not open app: " + e.getMessage());
        }
    }

    @PluginMethod
    public void listApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        JSArray arr = new JSArray();
        HashSet<String> seen = new HashSet<>();
        for (ResolveInfo ri : launcherApps()) {
            String label = ri.loadLabel(pm).toString();
            if (seen.add(label)) arr.put(label);
        }
        JSObject r = new JSObject();
        r.put("apps", arr);
        call.resolve(r);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (TextUtils.isEmpty(url)) { call.reject("url required"); return; }
        try {
            start(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            call.resolve();
        } catch (Exception e) {
            call.reject("No app can open this link");
        }
    }

    // ─── Hardware ───────────────────────────────────────────────────────
    @PluginMethod
    public void torch(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        try {
            CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            for (String id : cm.getCameraIdList()) {
                Boolean flash = cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (Boolean.TRUE.equals(flash)) {
                    cm.setTorchMode(id, on);
                    call.resolve();
                    return;
                }
            }
            call.reject("This phone has no flashlight");
        } catch (Exception e) {
            call.reject("Flashlight error: " + e.getMessage());
        }
    }

    @PluginMethod
    public void volume(PluginCall call) {
        String action = call.getString("action", "up");
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        int stream = AudioManager.STREAM_MUSIC;
        int max = am.getStreamMaxVolume(stream);
        int flags = AudioManager.FLAG_SHOW_UI;
        try {
            switch (action) {
                case "down": am.adjustStreamVolume(stream, AudioManager.ADJUST_LOWER, flags); break;
                case "mute": am.adjustStreamVolume(stream, AudioManager.ADJUST_MUTE, flags); break;
                case "unmute": am.adjustStreamVolume(stream, AudioManager.ADJUST_UNMUTE, flags); break;
                case "max": am.setStreamVolume(stream, max, flags); break;
                case "set": {
                    int pct = Math.max(0, Math.min(100, call.getInt("percent", 50)));
                    am.setStreamVolume(stream, Math.round(max * pct / 100f), flags);
                    break;
                }
                default: am.adjustStreamVolume(stream, AudioManager.ADJUST_RAISE, flags);
            }
            JSObject r = new JSObject();
            r.put("percent", Math.round(am.getStreamVolume(stream) * 100f / max));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Volume error: " + e.getMessage());
        }
    }

    @PluginMethod
    public void media(PluginCall call) {
        String action = call.getString("action", "play_pause");
        int code;
        switch (action) {
            case "play": code = KeyEvent.KEYCODE_MEDIA_PLAY; break;
            case "pause": code = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
            case "next": code = KeyEvent.KEYCODE_MEDIA_NEXT; break;
            case "previous": code = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
            default: code = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
        }
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        long t = SystemClock.uptimeMillis();
        am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0));
        am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_UP, code, 0));
        call.resolve();
    }

    // ─── Settings, alarms ───────────────────────────────────────────────
    @PluginMethod
    public void openSettings(PluginCall call) {
        String panel = call.getString("panel", "general");
        boolean q = Build.VERSION.SDK_INT >= 29;
        Intent i;
        switch (panel) {
            case "wifi": i = new Intent(q ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS); break;
            case "internet": case "mobile_data":
                i = new Intent(q ? Settings.Panel.ACTION_INTERNET_CONNECTIVITY : Settings.ACTION_WIRELESS_SETTINGS); break;
            case "bluetooth": i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS); break;
            case "volume": case "sound": i = new Intent(q ? Settings.Panel.ACTION_VOLUME : Settings.ACTION_SOUND_SETTINGS); break;
            case "display": case "brightness": i = new Intent(Settings.ACTION_DISPLAY_SETTINGS); break;
            case "battery": i = new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS); break;
            case "location": i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS); break;
            case "accessibility": i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS); break;
            case "app":
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                break;
            default: i = new Intent(Settings.ACTION_SETTINGS);
        }
        try {
            start(i);
            call.resolve();
        } catch (Exception e) {
            try { start(new Intent(Settings.ACTION_SETTINGS)); call.resolve(); }
            catch (Exception e2) { call.reject("Could not open settings"); }
        }
    }

    @PluginMethod
    public void setAlarm(PluginCall call) {
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        i.putExtra(AlarmClock.EXTRA_HOUR, (int) call.getInt("hour", 7));
        i.putExtra(AlarmClock.EXTRA_MINUTES, (int) call.getInt("minute", 0));
        i.putExtra(AlarmClock.EXTRA_MESSAGE, call.getString("message", "Myra alarm"));
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        try { start(i); call.resolve(); } catch (Exception e) { call.reject("No clock app found"); }
    }

    @PluginMethod
    public void setTimer(PluginCall call) {
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER);
        i.putExtra(AlarmClock.EXTRA_LENGTH, Math.max(1, call.getInt("seconds", 60)));
        i.putExtra(AlarmClock.EXTRA_MESSAGE, call.getString("message", "Myra timer"));
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        try { start(i); call.resolve(); } catch (Exception e) { call.reject("No clock app found"); }
    }

    // ─── Accessibility ──────────────────────────────────────────────────
    private boolean isAccessibilityOn() {
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        ComponentName me = new ComponentName(getContext(), AutoSendService.class);
        String all = enabled.toLowerCase(Locale.ROOT);
        return all.contains(me.flattenToString().toLowerCase(Locale.ROOT))
            || all.contains(me.flattenToShortString().toLowerCase(Locale.ROOT));
    }

    @PluginMethod
    public void accessibilityStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("enabled", isAccessibilityOn());
        call.resolve(r);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try { start(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); call.resolve(); }
        catch (Exception e) { call.reject("Could not open accessibility settings"); }
    }

    @PluginMethod
    public void phoneAction(PluginCall call) {
        AutoSendService svc = AutoSendService.instance;
        if (svc == null) { call.reject("ACCESSIBILITY_OFF"); return; }
        String action = call.getString("action", "");
        getActivity().runOnUiThread(() -> {
            if (svc.doGlobal(action)) call.resolve();
            else call.reject("Not supported: " + action);
        });
    }
}

package com.aayat.assistant;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/** Notifications padhne aur reply karne ke liye. */
public class MyraNotificationService extends NotificationListenerService {
    static MyraNotificationService instance;

    static class Item {
        String key, pkg, app, title, text, category;
        long time;
    }

    private final Deque<Item> recent = new ArrayDeque<>();

    @Override public void onListenerConnected() { instance = this; }
    @Override public void onListenerDisconnected() { instance = null; }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        Notification n = sbn.getNotification();
        if (n == null) return;
        Bundle ex = n.extras;
        if (ex == null) return;
        CharSequence title = ex.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = ex.getCharSequence(Notification.EXTRA_TEXT);
        if (title == null && text == null) return;

        Item it = new Item();
        it.key = sbn.getKey();
        it.pkg = sbn.getPackageName();
        it.app = appLabel(sbn.getPackageName());
        it.title = title != null ? title.toString() : "";
        it.text = text != null ? text.toString() : "";
        it.category = n.category;
        it.time = sbn.getPostTime();

        synchronized (recent) {
            recent.removeIf(x -> x.key.equals(it.key));
            recent.addFirst(it);
            while (recent.size() > 30) recent.removeLast();
        }
        if (DeviceControlPlugin.instance != null)
            DeviceControlPlugin.instance.emitNotification(it);
    }

    private String appLabel(String pkg) {
        try {
            Context c = createPackageContext(pkg, 0);
            return getPackageManager().getApplicationLabel(c.getApplicationInfo()).toString();
        } catch (Exception e) {
            if (pkg.contains("whatsapp")) return "WhatsApp";
            return pkg;
        }
    }

    List<Item> list(String appFilter, int limit) {
        List<Item> out = new ArrayList<>();
        synchronized (recent) {
            for (Item it : recent) {
                if (appFilter != null && !appFilter.isEmpty()
                        && !it.app.toLowerCase().contains(appFilter.toLowerCase())
                        && !it.pkg.toLowerCase().contains(appFilter.toLowerCase())) continue;
                out.add(it);
                if (out.size() >= limit) break;
            }
        }
        return out;
    }

    /** Notification ke andar chhupe "Reply" action ko fill karke bhejo (WhatsApp etc.) */
    boolean reply(String match, String message) {
        StatusBarNotification target = null;
        String m = match == null ? "" : match.toLowerCase();
        for (StatusBarNotification sbn : safeActive()) {
            Bundle ex = sbn.getNotification().extras;
            CharSequence title = ex != null ? ex.getCharSequence(Notification.EXTRA_TITLE) : null;
            if (title != null && title.toString().toLowerCase().contains(m)) {
                if (findRemoteInput(sbn) != null) { target = sbn; break; }
            }
        }
        if (target == null) return false;
        Notification.Action action = findRemoteInput(target);
        if (action == null) return false;
        try {
            android.content.Intent intent = new android.content.Intent();
            Bundle results = new Bundle();
            for (android.app.RemoteInput ri : action.getRemoteInputs()) results.putCharSequence(ri.getResultKey(), message);
            android.app.RemoteInput.addResultsToIntent(action.getRemoteInputs(), intent, results);
            action.actionIntent.send(this, 0, intent);
            return true;
        } catch (PendingIntent.CanceledException e) {
            return false;
        }
    }

    String titleOf(String match) {
        String m = match == null ? "" : match.toLowerCase();
        for (StatusBarNotification sbn : safeActive()) {
            Bundle ex = sbn.getNotification().extras;
            CharSequence title = ex != null ? ex.getCharSequence(Notification.EXTRA_TITLE) : null;
            if (title != null && title.toString().toLowerCase().contains(m)) return title.toString();
        }
        return match;
    }

    private StatusBarNotification[] safeActive() {
        try {
            StatusBarNotification[] a = getActiveNotifications();
            return a != null ? a : new StatusBarNotification[0];
        } catch (Exception e) {
            return new StatusBarNotification[0];
        }
    }

    private Notification.Action findRemoteInput(StatusBarNotification sbn) {
        Notification n = sbn.getNotification();
        if (n.actions == null) return null;
        for (Notification.Action a : n.actions) {
            if (a.getRemoteInputs() != null && a.getRemoteInputs().length > 0) return a;
        }
        return null;
    }
}

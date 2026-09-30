package com.aayat.assistant;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

/**
 * Accessibility service:
 *  1. WhatsApp khulte hi "Send" button khud dabata hai (sirf jab Myra ne arm kiya ho)
 *  2. Phone-level actions: back, home, recents, notifications, lock, screenshot
 */
public class AutoSendService extends AccessibilityService {

    static volatile AutoSendService instance;
    private static volatile long armedAt = 0;
    private static final long ARM_WINDOW_MS = 20000;

    static void arm() {
        armedAt = System.currentTimeMillis();
    }

    private static boolean isArmed() {
        return armedAt > 0 && System.currentTimeMillis() - armedAt < ARM_WINDOW_MS;
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onInterrupt() {}

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!isArmed() || event == null || event.getPackageName() == null) return;
        String pkg = event.getPackageName().toString();
        if (!pkg.startsWith("com.whatsapp")) return;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        AccessibilityNodeInfo send = findSendButton(root, pkg);
        if (send != null && send.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            armedAt = 0;
            new Handler(Looper.getMainLooper()).postDelayed(this::returnToAssistant, 800);
        }
    }

    private AccessibilityNodeInfo findSendButton(AccessibilityNodeInfo root, String pkg) {
        List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByViewId(pkg + ":id/send");
        AccessibilityNodeInfo hit = firstClickable(nodes);
        if (hit != null) return hit;

        String[] labels = {"Send", "भेजें"};
        for (String label : labels) {
            nodes = root.findAccessibilityNodeInfosByText(label);
            if (nodes == null) continue;
            for (AccessibilityNodeInfo n : nodes) {
                CharSequence desc = n.getContentDescription();
                if (desc != null && desc.toString().equalsIgnoreCase(label)) {
                    AccessibilityNodeInfo c = clickableParent(n);
                    if (c != null) return c;
                }
            }
        }
        return null;
    }

    private AccessibilityNodeInfo firstClickable(List<AccessibilityNodeInfo> nodes) {
        if (nodes == null) return null;
        for (AccessibilityNodeInfo n : nodes) {
            if (n != null && n.isEnabled() && n.isVisibleToUser()) {
                AccessibilityNodeInfo c = clickableParent(n);
                if (c != null) return c;
            }
        }
        return null;
    }

    private AccessibilityNodeInfo clickableParent(AccessibilityNodeInfo n) {
        int depth = 0;
        while (n != null && !n.isClickable() && depth < 5) {
            n = n.getParent();
            depth++;
        }
        return (n != null && n.isClickable()) ? n : null;
    }

    private void returnToAssistant() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) return;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        try {
            startActivity(i);
        } catch (Exception ignored) {}
    }

    /** Returns false if the action isn't supported on this Android version. */
    boolean doGlobal(String action) {
        int code;
        switch (action) {
            case "back": code = GLOBAL_ACTION_BACK; break;
            case "home": code = GLOBAL_ACTION_HOME; break;
            case "recents": code = GLOBAL_ACTION_RECENTS; break;
            case "notifications": code = GLOBAL_ACTION_NOTIFICATIONS; break;
            case "quick_settings": code = GLOBAL_ACTION_QUICK_SETTINGS; break;
            case "power_menu": code = GLOBAL_ACTION_POWER_DIALOG; break;
            case "lock":
                if (Build.VERSION.SDK_INT < 28) return false;
                code = GLOBAL_ACTION_LOCK_SCREEN; break;
            case "screenshot":
                if (Build.VERSION.SDK_INT < 28) return false;
                code = GLOBAL_ACTION_TAKE_SCREENSHOT; break;
            default:
                return false;
        }
        return performGlobalAction(code);
    }
}

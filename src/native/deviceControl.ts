import { Capacitor, registerPlugin } from "@capacitor/core";

/** Android app ka native bridge (android/app/src/main/java/.../DeviceControlPlugin.java) */
export interface DeviceControlPlugin {
  call(o: { number: string }): Promise<{ direct: boolean }>;
  sendSms(o: { number: string; message: string }): Promise<{ direct: boolean }>;
  sendWhatsApp(o: { number: string; message: string; autoSend?: boolean }): Promise<{ installed: boolean; autoSend: boolean }>;
  getContacts(): Promise<{ contacts: { name: string; phone: string }[] }>;
  openApp(o: { name: string }): Promise<{ opened: boolean; label?: string }>;
  listApps(): Promise<{ apps: string[] }>;
  openUrl(o: { url: string }): Promise<void>;
  torch(o: { on: boolean }): Promise<void>;
  volume(o: { action: string; percent?: number }): Promise<{ percent: number }>;
  media(o: { action: string }): Promise<void>;
  openSettings(o: { panel: string }): Promise<void>;
  setAlarm(o: { hour: number; minute: number; message?: string }): Promise<void>;
  setTimer(o: { seconds: number; message?: string }): Promise<void>;
  accessibilityStatus(): Promise<{ enabled: boolean }>;
  openAccessibilitySettings(): Promise<void>;
  phoneAction(o: { action: string }): Promise<void>;
  // Notifications (NotificationListenerService)
  notificationAccessStatus(): Promise<{ enabled: boolean }>;
  openNotificationAccessSettings(): Promise<void>;
  getNotifications(o: { app?: string; limit?: number }): Promise<{ items: { key: string; app: string; title: string; text: string; time: number; category?: string }[] }>;
  replyNotification(o: { match: string; message: string }): Promise<{ sent: boolean; title?: string }>;
  // Wake word (Android SpeechRecognizer)
  // Smart alarm: app ko alarm time par khol de (best-effort)
  scheduleWake(o: { id: string; hour: number; minute: number; label: string }): Promise<void>;
  cancelWake(o: { id: string }): Promise<void>;
  startWakeListener(o: { words: string[] }): Promise<void>;
  stopWakeListener(): Promise<void>;
  addListener(event: "wake", fn: (d: { heard: string }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: "notification", fn: (d: { app: string; title: string; text: string; category?: string; pkg: string }) => void): Promise<{ remove: () => Promise<void> }>;
  checkPermissions(): Promise<Record<string, string>>;
  requestPermissions(o?: { permissions: string[] }): Promise<Record<string, string>>;
}

export const DeviceControl = registerPlugin<DeviceControlPlugin>("DeviceControl");

export const isNativeApp = () => Capacitor.isNativePlatform();

export const isMobileDevice = () =>
  isNativeApp() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

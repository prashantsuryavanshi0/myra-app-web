import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { X, ShieldCheck, Accessibility, Users, CheckCircle2, Bell } from "lucide-react";
import { DeviceControl } from "../native/deviceControl";
import { setDeviceContacts, getDeviceContactCount } from "../services/contactsService";

/** Android app: permissions + accessibility ek jagah */
export default function SetupPanel({ onClose }: { onClose: () => void }) {
  const [perms, setPerms] = useState<Record<string, string>>({});
  const [a11y, setA11y] = useState(false);
  const [notif, setNotif] = useState(false);
  const [contacts, setContacts] = useState(getDeviceContactCount());

  const refresh = useCallback(async () => {
    try { setPerms(await DeviceControl.checkPermissions()); } catch {}
    try { setA11y((await DeviceControl.accessibilityStatus()).enabled); } catch {}
    try { setNotif((await DeviceControl.notificationAccessStatus()).enabled); } catch {}
    setContacts(getDeviceContactCount());
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  const allGranted = ["microphone", "phone", "sms", "contacts"].every((k) => perms[k] === "granted");

  const grant = async () => {
    try {
      setPerms(await DeviceControl.requestPermissions({ permissions: ["microphone", "phone", "sms", "contacts", "location"] }));
      const r = await DeviceControl.getContacts();
      setDeviceContacts(r.contacts);
      setContacts(r.contacts.length);
    } catch {}
  };

  const Row = ({ done, icon, title, text, button, onClick }: any) => (
    <div className="flex gap-3 py-4 border-b border-white/5">
      <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${done ? "bg-emerald-500/20 text-emerald-300" : "bg-white/5 text-white/70"}`}>
        {done ? <CheckCircle2 size={18} /> : icon}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-white/55 leading-relaxed mt-0.5">{text}</p>
        {!done && (
          <button onClick={onClick} className="mt-2 px-3 py-1.5 rounded-lg bg-white text-black text-xs font-semibold">
            {button}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-[#0d0d12] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl px-5 pt-5 pb-6"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Phone control setup</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10" aria-label="Close"><X size={18} /></button>
        </div>
        <p className="text-xs text-white/55">One-time setup so Myra can call, message and control your phone directly.</p>

        <Row
          done={allGranted}
          icon={<ShieldCheck size={18} />}
          title="Mic, calls, SMS and contacts"
          text="Lets Myra hear you, place calls, send SMS and find people by name."
          button="Allow permissions"
          onClick={grant}
        />
        <Row
          done={contacts > 0}
          icon={<Users size={18} />}
          title={contacts > 0 ? `${contacts} contacts synced` : "Sync contacts"}
          text="Your phone contacts stay on this phone; only the name you say is matched."
          button="Sync now"
          onClick={grant}
        />
        <Row
          done={a11y}
          icon={<Accessibility size={18} />}
          title="WhatsApp auto-send and phone actions"
          text={
            'Open Accessibility → Installed apps → "Myra phone control" → turn on. On Android 13+, if it is greyed out: App info → ⋮ menu → "Allow restricted settings" first.'
          }
          button="Open accessibility settings"
          onClick={() => DeviceControl.openAccessibilitySettings()}
        />
        <Row
          done={notif}
          icon={<Bell size={18} />}
          title="Read & reply to notifications"
          text='Lets Myra tell you who is calling or messaging, read them out, and reply to WhatsApp from the notification. Turn on "Myra notifications".'
          button="Open notification access"
          onClick={() => DeviceControl.openNotificationAccessSettings()}
        />
        {!a11y && (
          <button
            onClick={() => DeviceControl.openSettings({ panel: "app" })}
            className="mt-3 text-xs text-violet-300 underline underline-offset-2"
          >
            Open App info (for “Allow restricted settings”)
          </button>
        )}
      </motion.div>
    </div>
  );
}

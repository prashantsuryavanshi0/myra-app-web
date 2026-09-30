import { useEffect, useState } from "react";
import { motion } from "motion/react";
import QRCode from "qrcode";
import { Phone, MessageSquare, MessageCircle, Youtube, Music, Globe, Search, MapPin, Mail, X, Copy, Check } from "lucide-react";
import type { PendingAction, ActionIcon } from "../services/tools";
import { isMobileDevice } from "../native/deviceControl";

const ICONS: Record<ActionIcon, { Icon: any; tint: string }> = {
  call: { Icon: Phone, tint: "from-emerald-500 to-green-600" },
  sms: { Icon: MessageSquare, tint: "from-sky-500 to-blue-600" },
  whatsapp: { Icon: MessageCircle, tint: "from-green-500 to-emerald-700" },
  youtube: { Icon: Youtube, tint: "from-red-500 to-rose-700" },
  music: { Icon: Music, tint: "from-green-400 to-lime-600" },
  web: { Icon: Globe, tint: "from-violet-500 to-fuchsia-600" },
  search: { Icon: Search, tint: "from-blue-500 to-indigo-600" },
  maps: { Icon: MapPin, tint: "from-amber-500 to-orange-600" },
  email: { Icon: Mail, tint: "from-pink-500 to-rose-600" },
};

interface Props {
  action: PendingAction;
  opened: boolean;
  popupBlocked: boolean;
  onDone: () => void;
}

export default function ActionCard({ action, opened, popupBlocked, onDone }: Props) {
  const { Icon, tint } = ICONS[action.icon] || ICONS.web;
  const isWeb = action.url.startsWith("http");
  const laptop = !isMobileDevice();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Laptop pe call/SMS: phone se scan karo aur seedha dial/send
  useEffect(() => {
    if (!laptop || !action.phone) return;
    QRCode.toDataURL(action.url, { margin: 1, width: 180, color: { dark: "#000000", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [action.url, action.phone, laptop]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(action.copyText || action.phone || action.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const verb = action.icon === "call" ? "Call" : action.icon === "sms" || action.icon === "whatsapp" ? "Send" : "Open";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.96 }}
      className="w-[calc(100%-2rem)] max-w-md bg-white/[0.06] border border-white/15 rounded-2xl p-2 pl-3 backdrop-blur-xl shadow-2xl"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br ${tint} flex items-center justify-center`}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{action.label}</p>
          <p className="text-xs text-white/50">
            {opened ? "Opened in a new tab" : laptop && action.phone ? "Opens on your linked phone, or scan below" : "Tap to open"}
          </p>
        </div>
        <a
          href={action.url}
          target={isWeb ? "_blank" : undefined}
          rel="noopener noreferrer"
          onClick={() => setTimeout(onDone, 300)}
          className="px-4 py-2.5 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
        >
          {verb}
        </a>
        {(action.copyText || action.phone) && (
          <button onClick={copy} className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10" aria-label="Copy">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        )}
        <button onClick={onDone} className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10" aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>

      {qr && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/10">
          <img src={qr} alt="QR code to call or message from your phone" className="w-24 h-24 rounded-lg bg-white p-1" />
          <p className="text-xs text-white/60 leading-relaxed">
            Laptop has no SIM. Scan this with your phone camera to {action.icon === "call" ? "call" : "send the SMS"} instantly,
            or pair your phone with Phone Link (Windows) / iPhone (Mac) so the button works directly.
          </p>
        </div>
      )}

      {popupBlocked && !opened && isWeb && (
        <p className="text-xs text-amber-300/90 mt-2 pt-2 border-t border-white/10 leading-relaxed">
          Your browser blocked the auto-open. Click the pop-up icon in the address bar and choose “Always allow” — after that, everything opens automatically.
        </p>
      )}
    </motion.div>
  );
}

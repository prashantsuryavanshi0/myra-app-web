import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Mic, Moon, Keyboard, Send, Trash2, Users, Settings, Smartphone, Volume2, VolumeX,
  Camera, MonitorUp, WifiOff, EarOff, Sun, AlarmClock, BellRing, MessageSquare, ChevronDown,
} from "lucide-react";
import { getMyraResponse, getMyraAudio, resetMyraSession } from "./services/geminiService";
import { LiveSessionManager, LiveState } from "./services/liveService";
import { PendingAction, ToolOutcome, MediaItem, MediaCommand, onReminder, restoreReminders } from "./services/tools";
import { DeviceControl, isNativeApp, isMobileDevice } from "./native/deviceControl";
import { setDeviceContacts } from "./services/contactsService";
import { WakeWordListener, WakeStatus } from "./services/wakeWord";
import { getSettings, onSettingsChange, Settings as AppSettings, MODES } from "./services/settings";
import { ASSISTANT_NAME, SLEEP_WORDS } from "./config";
import Face, { FaceState } from "./components/Face";
import PermissionModal from "./components/PermissionModal";
import ActionCard from "./components/ActionCard";
import ContactsPanel from "./components/ContactsPanel";
import YouTubePlayer from "./components/YouTubePlayer";
import SetupPanel from "./components/SetupPanel";
import SettingsPanel from "./components/SettingsPanel";
import CameraView, { CameraMode } from "./components/CameraView";
import AlarmsPanel from "./components/AlarmsPanel";
import { alarmEngine, AlarmEvent, describeAlarm, Alarm } from "./services/alarmService";
import { unlockAudio } from "./services/audioBus";
import { playPCM } from "./utils/audioUtils";

/** off = kuch nahi sun rahi | sleeping = sirf "Hello Myra" sun rahi | awake = baat ho rahi */
type Power = "off" | "sleeping" | "awake";

interface ChatMessage {
  id: string;
  sender: "user" | "aayat";
  text: string;
}

const HISTORY_KEY = "myra_chat_history";

export default function App() {
  const native = isNativeApp();
  const mobile = isMobileDevice();
  const canShareScreen = !mobile && !!navigator.mediaDevices?.getDisplayMedia;
  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Mobile pe background animation band karo (CPU bachao)
  const bgAnimate = !mobile && !prefersReducedMotion;

  // ─── State ────────────────────────────────────────────────────────────
  const [power, setPower] = useState<Power>("off");
  const [liveState, setLiveState] = useState<LiveState>("idle");
  const [textBusy, setTextBusy] = useState<"idle" | "processing" | "speaking">("idle");
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>("paused");
  const [online, setOnline] = useState(navigator.onLine);
  const [settings, setSettings] = useState<AppSettings>(getSettings);
  const [needsTap, setNeedsTap] = useState(!native && !(navigator as any).userActivation?.hasBeenActive);

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });
  const messagesRef = useRef(messages);
  const [isMuted, setIsMuted] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionOpened, setActionOpened] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [mediaCmd, setMediaCmd] = useState<{ type: MediaCommand; nonce: number } | null>(null);
  const [camera, setCamera] = useState<CameraMode | null>(null);
  const [showAlarms, setShowAlarms] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [ringing, setRinging] = useState<{ alarm: Alarm; attempt: number } | null>(null);

  const liveRef = useRef<LiveSessionManager | null>(null);
  const wakeRef = useRef<WakeWordListener | null>(null);
  const powerRef = useRef<Power>("off");
  const lastActivity = useRef(Date.now());
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const actionTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef(settings);

  useEffect(() => { powerRef.current = power; }, [power]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => onSettingsChange(setSettings), []);
  useEffect(() => {
    messagesRef.current = messages;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-200)));
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);
  useEffect(() => { if (liveRef.current) liveRef.current.isMuted = isMuted; }, [isMuted]);

  const showToast = useCallback((text: string, ms = 6000) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  // Alarm pe Myra jo bolegi (rotate + escalate). TTS se guaranteed bajega.
  const wakeLine = useCallback((label: string, attempt: number) => {
    const h = new Date().getHours();
    const lbl = label !== "Alarm" ? label : null;

    // Time-aware first messages
    const first =
      h >= 5 && h < 12 ? [
        // Morning (5am-12pm)
        lbl
          ? `Good morning! ${lbl} ka time ho gaya — chalo uth jao, din shuru karo! 🌅`
          : `Good morning! Subah ho gayi, aankhein kholo aur ek pyari stretch karo! ☀️`,
        `Uth jao uth jao! Subah ki taaza hawa tumhara intezaar kar rahi hai${lbl ? ` — ${lbl} yaad hai na?` : ""}! 🌤️`,
        `Wakey wakey! Subah ka pehla ghanta sabse important hota hai, chalo ready ho jao! 💪`,
      ] : h >= 12 && h < 17 ? [
        // Afternoon (12pm-5pm)
        lbl
          ? `Hey! ${lbl} ka alarm baja — ab mat bhulo, chalo uth ke ready ho jao! ⏰`
          : `Dopahar ho gayi! Nap zyada ho gayi kya? Chalo uth jao! ☀️`,
        `Rise and shine${lbl ? ` — ${lbl} wait kar raha hai` : ""}! Dopahar ka time hai, chalo hil-dol! 🌞`,
        `Alarm baj gaya! ${lbl ? lbl + " ke liye" : "Dopahar mein"} ab uthna hi padega, chalo! ⚡`,
      ] : h >= 17 && h < 21 ? [
        // Evening (5pm-9pm)
        lbl
          ? `Hey! Shaam ka alarm — ${lbl}. Time aa gaya, ab mat ruko! 🌆`
          : `Shaam ho gayi! Alarm baja hai, kuch kaam bacha tha kya? Chalo uth jao! 🌇`,
        `Good evening! ${lbl ? lbl + " — yaad hai na?" : "Shaam ka alarm baj gaya!"} Chalo ready ho jao! 🌆`,
        `Ding ding! ${lbl ? lbl + " ka time." : "Shaam ka alarm."} Chal uth, kaam khatam karo! ⏰`,
      ] : [
        // Night (9pm-5am)
        lbl
          ? `Hey! Raat ka alarm — ${lbl}. Time ho gaya, ab uthna padega! 🌙`
          : `Raat ka alarm baj gaya! Kuch important tha kya? Chalo dekh lo! 🌙`,
        `Night alarm! ${lbl ? lbl + " — bhula nahi na?" : "Kuch kaam tha kya raat mein?"} Chalo uth ke dekh! 🌃`,
        `Uth jao! ${lbl ? lbl + " ke liye alarm tha." : "Raat ka alarm baja."} Miss mat karo! ⭐`,
      ];

    // Nag messages (wakeCheck attempts) — always energetic
    const nag = [
      `Aree! Wapas mat sona${lbl ? ` — ${lbl} abhi bhi wait kar raha hai` : ""}! Chalo aankhein kholo! 😤`,
      `Main jaanti hoon tum abhi tak nahi uthe! Chalo ab sach mein uth jao, main bajti rahungi! 🔔`,
      `Yeh teri ${attempt}vi baar hai! ${lbl ? lbl + " — " : ""}Utho, warna sach mein miss ho jayega! ⚠️`,
      `Bas bahut ho gaya! Uth jao aur bolo "main uth gaya"! Come on! 💥`,
    ];

    const arr = attempt <= 1 ? first : nag;
    return arr[Math.floor(Math.random() * arr.length)];
  }, []);

  const addMessage = useCallback((sender: "user" | "aayat", text: string) => {
    setMessages((prev) => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, sender, text }]);
  }, []);

  // ─── Tool results → UI ───────────────────────────────────────────────
  const handleAction = useCallback((action: PendingAction) => {
    setPendingAction(action);
    let opened = false;
    if (action.url.startsWith("http")) {
      try { opened = !!window.open(action.url, "_blank", "noopener"); } catch {}
    }
    setActionOpened(opened);
    setPopupBlocked(action.url.startsWith("http") && !opened);
    window.clearTimeout(actionTimer.current);
    actionTimer.current = window.setTimeout(() => setPendingAction(null), opened ? 6000 : 45000);
  }, []);

  // ─── Wake word (sleep mode) ──────────────────────────────────────────
  const startWakeListening = useCallback(() => {
    if (!settingsRef.current.wakeEnabled || !WakeWordListener.isSupported()) return false;
    if (!wakeRef.current) {
      const w = new WakeWordListener();
      w.onStatus = setWakeStatus;
      w.onWake = (rest) => wakeUpRef.current(rest);
      wakeRef.current = w;
    }
    wakeRef.current.start();
    return true;
  }, []);

  const stopWakeListening = useCallback(() => {
    wakeRef.current?.stop();
  }, []);

  // ─── Sleep ───────────────────────────────────────────────────────────
  const goToSleep = useCallback((reason?: string) => {
    liveRef.current?.stop();
    liveRef.current = null;
    setLiveState("idle");
    setCamera(null); // sote waqt camera/screen band
    resetMyraSession();
    const listening = navigator.onLine && startWakeListening();
    setPower(listening ? "sleeping" : "off");
    if (reason) showToast(reason);
  }, [startWakeListening, showToast]);

  // ─── Wake up (live session) ──────────────────────────────────────────
  const wakeUpRef = useRef<(rest?: string, systemNote?: string) => void>(() => {});
  const wakeUp = useCallback(async (rest?: string, systemNote?: string) => {
    if (powerRef.current === "awake" && liveRef.current?.active) {
      if (rest) liveRef.current.sendText(rest);
      return;
    }
    if (!navigator.onLine) {
      showToast("📴 Internet nahi hai. Connect hote hi main sun lungi.");
      return;
    }
    stopWakeListening();
    setPower("awake");
    lastActivity.current = Date.now();
    await new Promise((r) => setTimeout(r, 250)); // mic free hone do

    const session = new LiveSessionManager();
    session.isMuted = isMuted;
    liveRef.current = session;
    session.onStateChange = (s) => { if (liveRef.current === session) setLiveState(s); };
    session.onMessage = (sender, text) => {
      addMessage(sender, text);
      // Chhota "bye"/"so jao" command: model ne tool na bhi chalaya toh bhi so jao
      if (sender === "user" && text.split(/\s+/).length <= 5 && SLEEP_WORDS.some((w) => text.toLowerCase().includes(w))) {
        window.setTimeout(() => {
          if (liveRef.current === session) goToSleep();
        }, Math.max(2500, session.msUntilSilent() + 1200));
      }
    };
    session.onActivity = () => { lastActivity.current = Date.now(); };
    session.onOutcome = (o) => handleOutcomeRef.current(o);
    session.onClosed = (reason) => {
      if (liveRef.current !== session) return;
      liveRef.current = null;
      if (/quota|exceeded|429|RESOURCE_EXHAUSTED/i.test(reason)) {
        goToSleep("⚠️ Free quota abhi khatam hai. Thodi der baad “Hello Myra” bolna.");
      } else if (/permission|NotAllowed|denied/i.test(reason)) {
        setShowPermissionModal(true);
        goToSleep();
      } else if (powerRef.current === "awake") {
        goToSleep(navigator.onLine ? undefined : "📴 Internet chala gaya. Wapas aate hi bulana.");
      }
    };

    await session.start();
    if (liveRef.current !== session || !session.active) return;
    if (videoEl.current) session.attachVideo(videoEl.current);

    // Pehli subah ki baat: briefing
    const today = new Date().toDateString();
    const hour = new Date().getHours();
    let note = systemNote;
    if (!note && !rest && hour >= 5 && hour < 11 && localStorage.getItem("myra_last_briefing") !== today) {
      localStorage.setItem("myra_last_briefing", today);
      note = "[SYSTEM] This is the user's first wake-up this morning. Greet them and give the morning briefing.";
    }
    if (note) session.sendText(note);
    if (rest) session.sendText(rest);
  }, [isMuted, addMessage, goToSleep, stopWakeListening, showToast]);
  useEffect(() => { wakeUpRef.current = wakeUp; }, [wakeUp]);

  /** Mode ya voice badla: Myra ki baat khatam hone do, phir naye setting se session */
  const restartSession = useCallback(() => {
    const s = liveRef.current;
    if (!s || powerRef.current !== "awake") return;
    window.setTimeout(() => {
      if (liveRef.current !== s) return;
      s.onClosed = () => {};
      s.stop();
      liveRef.current = null;
      setPower("sleeping");
      wakeUpRef.current(undefined, "[SYSTEM] Your personality/voice was just changed. Greet the user in one short line in the new style.");
    }, s.msUntilSilent() + 900);
  }, []);

  const handleOutcomeRef = useRef<(o: ToolOutcome) => void>(() => {});
  const handleOutcome = useCallback((o: ToolOutcome) => {
    if (o.action) handleAction(o.action);
    if (o.media) { setMediaCmd(null); setMedia(o.media); }
    if (o.mediaCommand) setMediaCmd({ type: o.mediaCommand, nonce: Date.now() });
    if (o.camera === "off") setCamera(null);
    if (o.camera === "on") setCamera((c) => c || (mobile ? "environment" : "user"));
    if (o.camera === "flip") setCamera((c) => (c === "user" ? "environment" : "user"));
    if (o.restartSession) restartSession();
    if (o.sleep) {
      const s = liveRef.current;
      window.setTimeout(() => { if (liveRef.current === s) goToSleep(); }, (s?.msUntilSilent() || 0) + 1500);
    }
  }, [handleAction, restartSession, goToSleep, mobile]);
  useEffect(() => { handleOutcomeRef.current = handleOutcome; }, [handleOutcome]);

  // ─── Auto-sleep jab chup ho (quota bachao) ───────────────────────────
  useEffect(() => {
    const t = window.setInterval(() => {
      const secs = settingsRef.current.autoSleepSeconds;
      const s = liveRef.current;
      if (!secs || powerRef.current !== "awake" || !s) return;
      if (s.msUntilSilent() > 0) return;
      if (Date.now() - lastActivity.current > secs * 1000) goToSleep("😴 Chup the, toh main so gayi. “Hello Myra” bolo.");
    }, 5000);
    return () => window.clearInterval(t);
  }, [goToSleep]);

  // ─── Startup: permissions, contacts, sleep mode ──────────────────────
  useEffect(() => {
    if (native) {
      (async () => {
        try {
          const perms = await DeviceControl.checkPermissions();
          if (perms.contacts === "granted") setDeviceContacts((await DeviceControl.getContacts()).contacts);
        } catch {}
        if (!localStorage.getItem("setup_seen")) {
          localStorage.setItem("setup_seen", "1");
          setShowSetup(true);
        }
        goToSleep();
      })();
    } else if (!needsTap) {
      goToSleep();
    }
    return () => {
      liveRef.current?.stop();
      wakeRef.current?.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Laptop browser: pehla tap audio + mic unlock karta hai
  const unlock = () => {
    unlockAudio();
    setNeedsTap(false);
    goToSleep();
  };

  // Wake setting on/off hua
  useEffect(() => {
    if (powerRef.current === "awake" || needsTap) return;
    if (settings.wakeEnabled) goToSleep();
    else { stopWakeListening(); setPower("off"); }
  }, [settings.wakeEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Internet aaya/gaya ──────────────────────────────────────────────
  useEffect(() => {
    const on = () => {
      setOnline(true);
      if (needsTap) return;
      if (powerRef.current !== "awake" && settingsRef.current.wakeEnabled) {
        stopWakeListening();
        goToSleep(`🌐 Internet aa gaya! “Hello ${ASSISTANT_NAME}” bolo.`);
      }
    };
    const off = () => {
      setOnline(false);
      stopWakeListening();
      if (powerRef.current === "awake") goToSleep("📴 Internet chala gaya.");
      else setWakeStatus("offline");
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [goToSleep, stopWakeListening, needsTap]);

  // ─── Smart alarm engine (chalta rehta hai, sleep me bhi) ─────────────
  useEffect(() => {
    alarmEngine.start((e: AlarmEvent) => {
      if (e.type === "pre") {
        showToast(`⏰ ${describeAlarm(e.alarm)} — ${e.minsLeft} min me alarm`, 10000);
        wakeUpRef.current(undefined, `[SYSTEM] Alarm "${e.alarm.label}" rings in about ${e.minsLeft} minutes. Gently tell the user to start waking up, in one short motivating line.`);
        return;
      }
      // ring ya wakeCheck: sleep me ho to PEHLE jaga do, phir alarm
      // Auto-wake from sleep when alarm fires
      if (!liveRef.current?.active) {
        // Session nahi hai — pehle wake karo (silent), phir alarm
        wakeUpRef.current(undefined, undefined); // silent wake
      }
      // ring ya wakeCheck: overlay dikhao, Myra ki awaaz turant (TTS, guaranteed), phir sun-ne ke liye session
      setRinging({ alarm: e.alarm, attempt: e.attempt });
      const line = wakeLine(e.alarm.label, e.attempt);
      addMessage("aayat", line);
      alarmEngine.duck(true);
      getMyraAudio(line).then((a) => {
        if (a) playPCM(a).finally(() => alarmEngine.duck(false));
        else alarmEngine.duck(false);
      });
      // 2.5s baad live session shuru — taaki "main uth gaya" / "5 min aur" sun sake
      window.setTimeout(() => {
        if (alarmEngine.ringing) wakeUpRef.current(undefined, "[SYSTEM] An alarm is ringing and you just greeted the user out loud. Now stay quiet and LISTEN. If they say they're awake, call confirm_awake and praise them. If they ask for more time, call snooze_alarm. Do not repeat the greeting.");
      }, 2500);
    });
    return () => alarmEngine.stop();
  }, [showToast]);

  // Myra bol rahi ho toh alarm beep halka (awaaz saaf sune)
  useEffect(() => {
    if (ringing) alarmEngine.duck(liveState === "speaking" || liveState === "processing");
  }, [liveState, ringing]);

  // ─── Reminders ───────────────────────────────────────────────────────
  useEffect(() => {
    onReminder((text) => {
      showToast(`⏰ ${text}`, 15000);
      if (liveRef.current?.active) liveRef.current.sendText(`[SYSTEM] Reminder is due now: "${text}". Remind the user out loud.`);
      else wakeUpRef.current(undefined, `[SYSTEM] Reminder is due now: "${text}". Remind the user out loud, then ask if they need anything.`);
    });
    restoreReminders();
  }, [showToast]);

  // ─── Android: call/message announce ──────────────────────────────────
  useEffect(() => {
    if (!native) return;
    let sub: { remove: () => Promise<void> } | null = null;
    DeviceControl.addListener("notification", async (n) => {
      const st = settingsRef.current;
      const isCall = n.category === "call";
      if ((isCall && !st.announceCalls) || (!isCall && !st.announceMessages)) return;
      const line = isCall ? `${n.title} ka call aa raha hai` : `${n.app} pe ${n.title} ka message: ${n.text}`;
      showToast(isCall ? `📞 ${line}` : `💬 ${line}`, 8000);
      if (liveRef.current?.active) {
        liveRef.current.sendText(`[SYSTEM] ${isCall ? `Incoming call from ${n.title}` : `New ${n.app} message from ${n.title}: "${n.text}"`}. Tell the user in one short line.`);
      } else {
        const audio = await getMyraAudio(line);
        if (audio) playPCM(audio).catch(() => {});
      }
    }).then((s) => { sub = s; }).catch(() => {});
    return () => { sub?.remove().catch(() => {}); };
  }, [native, showToast]);

  const dismissAlarm = useCallback(() => { alarmEngine.dismiss(); setRinging(null); }, []);
  const snoozeAlarm = useCallback(() => { alarmEngine.snooze(5); setRinging(null); showToast("😴 5 min ka snooze. Zyada mat sona!"); if (liveRef.current?.active) liveRef.current.sendText("[SYSTEM] User snoozed for 5 minutes. Tease them lightly in one line."); }, [showToast]);
  const confirmAwake = useCallback(() => { alarmEngine.confirmAwake(); setRinging(null); if (liveRef.current?.active) liveRef.current.sendText("[SYSTEM] User confirmed they are awake. Praise them and give a one-line boost for the day."); }, []);

  // ─── Camera frames → session ─────────────────────────────────────────
  const onVideo = useCallback((el: HTMLVideoElement | null) => {
    videoEl.current = el;
    liveRef.current?.attachVideo(el);
  }, []);

  // ─── Typing mode ─────────────────────────────────────────────────────
  const handleTextCommand = useCallback(async (text: string) => {
    if (!text.trim()) return;
    addMessage("user", text);
    if (liveRef.current?.active) {
      liveRef.current.sendText(text);
      return;
    }
    setTextBusy("processing");
    const reply = await getMyraResponse(text, messagesRef.current);
    addMessage("aayat", reply.text);
    reply.outcomes.forEach(handleOutcome);
    if (!isMuted) {
      setTextBusy("speaking");
      const audio = await getMyraAudio(reply.text);
      if (audio) { try { await playPCM(audio); } catch (e) { console.error("[Audio playback]", e); } }
    }
    setTextBusy("idle");
  }, [isMuted, addMessage, handleOutcome]);

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    handleTextCommand(textInput);
    setTextInput("");
  };

  // ─── Face + status ───────────────────────────────────────────────────
  const faceState: FaceState =
    power === "awake"
      ? liveState === "idle" ? "waking" : liveState
      : textBusy !== "idle" ? textBusy : power === "sleeping" ? "sleeping" : "off";

  const status = (() => {
    if (!online) return { icon: <WifiOff size={14} />, text: "Offline — internet aate hi sun lungi" };
    if (power === "awake") {
      if (liveState === "idle") return { icon: <Sun size={14} />, text: "Jaag rahi hoon…" };
      if (liveState === "speaking") return { icon: <Volume2 size={14} />, text: "Bol rahi hoon" };
      if (liveState === "processing") return { icon: <Sun size={14} />, text: "Soch rahi hoon…" };
      return { icon: <Mic size={14} />, text: `Sun rahi hoon · “bye ${ASSISTANT_NAME}” se so jaungi` };
    }
    if (power === "sleeping" && wakeStatus === "listening") return { icon: <Moon size={14} />, text: `So rahi hoon · bolo “Hello ${ASSISTANT_NAME}”` };
    if (wakeStatus === "unsupported") return { icon: <EarOff size={14} />, text: mobile ? `Neeche "Wake up" dabao 👇` : "Chrome use karo wake word ke liye" };
    if (wakeStatus === "denied") return { icon: <EarOff size={14} />, text: "Mic permission chahiye" };
    return { icon: <EarOff size={14} />, text: mobile ? `Neeche "Wake up" dabao 👇` : "Kaan band hain · Wake up dabao" };
  })();

  const iconBtn = "p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10";

  return (
    <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden">
      {showPermissionModal && <PermissionModal onClose={() => setShowPermissionModal(false)} />}
      {showContacts && <ContactsPanel onClose={() => setShowContacts(false)} />}
      {showSetup && <SetupPanel onClose={() => setShowSetup(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onNeedsRestart={restartSession} />}
      {showAlarms && <AlarmsPanel onClose={() => setShowAlarms(false)} />}
      <AnimatePresence>
        {media && <YouTubePlayer key={media.videoId} media={media} command={mediaCmd} onClose={() => setMedia(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {camera && (
          <CameraView
            key={camera === "screen" ? "screen" : "cam"}
            mode={camera}
            onVideo={onVideo}
            onFlip={() => setCamera((c) => (c === "user" ? "environment" : "user"))}
            onClose={() => setCamera(null)}
          />
        )}
      </AnimatePresence>

      {/* Alarm baj raha hai */}
      <AnimatePresence>
        {ringing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-gradient-to-b from-violet-950/95 to-black/95 backdrop-blur-md px-6 text-center"
          >
            <motion.div animate={{ rotate: [-12, 12, -12] }} transition={{ duration: 0.7, repeat: Infinity }}>
              <BellRing size={72} className="text-amber-300" />
            </motion.div>
            <p className="mt-6 text-5xl font-bold tracking-tight">{describeAlarm(ringing.alarm).split(" (")[0]}</p>
            <p className="mt-2 text-lg text-white/70">{ringing.alarm.label !== "Alarm" ? ringing.alarm.label : "Uth jao! 🌅"}</p>
            {ringing.attempt > 1 && <p className="mt-1 text-sm text-amber-300/80">Wapas mat sona… ({ringing.attempt}){"" }</p>}
            <div className="mt-10 flex flex-col gap-3 w-full max-w-xs">
              <button onClick={confirmAwake} className="py-4 rounded-2xl bg-white text-black font-bold text-lg shadow-2xl">Main uth gaya ✅</button>
              <div className="flex gap-3">
                <button onClick={snoozeAlarm} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 font-semibold">5 min aur 😴</button>
                <button onClick={dismissAlarm} className="flex-1 py-3 rounded-2xl bg-white/10 border border-white/20 font-semibold">Band karo</button>
              </div>
            </div>
            <p className="mt-6 text-xs text-white/40">Ya bas bol do — Myra sun rahi hai</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Laptop: pehla tap */}
      <AnimatePresence>
        {needsTap && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={unlock}
            className="fixed inset-0 z-40 flex flex-col items-center justify-end pb-40 bg-black/40 backdrop-blur-[2px] text-center"
          >
            <span className="px-5 py-3 rounded-2xl bg-white text-black font-semibold shadow-2xl">Tap to turn on {ASSISTANT_NAME}</span>
            <span className="mt-2 text-xs text-white/60">Browser needs one tap before she can listen and talk</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0d0a1a] via-[#0a0812] to-[#050308]" />
        {bgAnimate ? (
          <>
            <motion.div
              className="absolute top-[-25%] left-[-15%] w-[65%] h-[65%] bg-violet-700/20 blur-[130px] rounded-full"
              animate={{ x: [0, 30, 0], y: [0, 20, 0] }}
              transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              className="absolute bottom-[-25%] right-[-15%] w-[65%] h-[65%] bg-pink-700/20 blur-[130px] rounded-full"
              animate={{ x: [0, -30, 0], y: [0, -20, 0] }}
              transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
            />
          </>
        ) : (
          <>
            <div className="absolute top-[-25%] left-[-15%] w-[65%] h-[65%] bg-violet-700/20 blur-[120px] rounded-full" />
            <div className="absolute bottom-[-25%] right-[-15%] w-[65%] h-[65%] bg-pink-700/20 blur-[120px] rounded-full" />
          </>
        )}
        <div className="absolute top-[30%] left-[40%] w-[30%] h-[30%] bg-cyan-600/10 blur-[120px] rounded-full" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
      </div>


      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-center z-20 px-4 py-4 md:px-12 md:py-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center font-bold text-sm">
            {ASSISTANT_NAME[0]}
          </div>
          <div>
            <h1 className="text-xl font-serif font-medium tracking-wide opacity-90 leading-none">{ASSISTANT_NAME}</h1>
            <button onClick={() => setShowSettings(true)} className="text-[11px] text-white/50 hover:text-white/80">
              {MODES[settings.mode].emoji} {MODES[settings.mode].label} mode
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          {native && (
            <button onClick={() => setShowSetup(true)} className={iconBtn} title="Phone control setup"><Smartphone size={18} className="opacity-70" /></button>
          )}
          <button onClick={() => setShowSettings(true)} className={iconBtn} title="Settings, modes & memory"><Settings size={18} className="opacity-70" /></button>
          {messages.length > 0 && (
            <button onClick={() => setShowChat((v) => !v)} className={`${iconBtn} ${showChat ? "text-violet-300" : ""}`} title={showChat ? "Hide chat" : "Show chat"}><MessageSquare size={18} className="opacity-70" /></button>
          )}
          <button onClick={() => setShowAlarms(true)} className={iconBtn} title="Alarms"><AlarmClock size={18} className="opacity-70" /></button>
          <button onClick={() => setShowContacts(true)} className={iconBtn} title="Contacts & notes"><Users size={18} className="opacity-70" /></button>
          {messages.length > 0 && (
            <button
              onClick={() => { if (confirm("Clear chat history?")) { setMessages([]); resetMyraSession(); } }}
              className={`${iconBtn} hover:bg-red-500/20 hover:text-red-400`}
              title="Clear chat history"
            >
              <Trash2 size={18} className="opacity-70" />
            </button>
          )}
          <button onClick={() => setIsMuted(!isMuted)} className={iconBtn} title={isMuted ? "Unmute" : "Mute"}>
            {isMuted ? <VolumeX size={18} className="opacity-70" /> : <Volume2 size={18} className="opacity-70" />}
          </button>
        </div>
      </header>

      {/* Face */}
      <main className="absolute inset-0 flex flex-col items-center justify-center z-10 pb-44 pt-16 pointer-events-none">
        <Face
          state={faceState}
          getLevel={() => liveRef.current?.getOutputLevel() || (textBusy === "speaking" ? 0.4 + Math.random() * 0.4 : 0)}
          getMicLevel={() => liveRef.current?.getInputLevel() || 0}
        />
        <div className="mt-8 flex items-center gap-2 text-xs md:text-sm text-white/70 px-4 py-2 rounded-full bg-white/[0.07] border border-white/10 backdrop-blur-md shadow-lg">
          {status.icon}
          <span>{status.text}</span>
        </div>
      </main>

      {/* Chat transcript — desktop: right side, mobile: bottom compact */}
      {messages.length > 0 && showChat && (
        <div
          ref={transcriptRef}
          className="fixed z-20 flex flex-col gap-1.5 overflow-y-auto rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md px-3 py-2
            left-2 right-2 bottom-28 max-h-28
            md:left-auto md:right-4 md:top-24 md:bottom-32 md:w-80 md:max-h-none"
        >
          <div className="flex items-center justify-between sticky top-0 -mt-2 -mx-3 px-3 pt-2 pb-1 bg-[#0b0b0f]/70 backdrop-blur-md">
            <span className="text-[11px] uppercase tracking-wider text-white/40">Chat</span>
            <button onClick={() => setShowChat(false)} className="p-1 rounded-lg text-white/40 hover:bg-white/10" title="Hide chat">
              <ChevronDown size={14} />
            </button>
          </div>
          {messages.slice(-40).map((m) => (
            <div key={m.id} className={`flex ${m.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`px-3 py-1.5 rounded-2xl text-sm max-w-[85%] whitespace-pre-wrap break-words ${
                m.sender === "user" ? "bg-violet-500/30 border border-violet-400/30" : "bg-pink-500/20 border border-pink-400/30"
              }`}>
                {m.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center pb-5 md:pb-8 z-20 gap-3 px-3">
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              onClick={() => setToast(null)}
              className="max-w-md px-4 py-3 rounded-2xl bg-amber-400 text-black text-sm font-semibold shadow-2xl cursor-pointer text-center"
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {pendingAction && (
            <ActionCard key={pendingAction.url} action={pendingAction} opened={actionOpened} popupBlocked={popupBlocked} onDone={() => setPendingAction(null)} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showTextInput && (
            <motion.form
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onSubmit={handleTextSubmit}
              className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md"
            >
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={`Type a message to ${ASSISTANT_NAME}...`}
                className="flex-1 bg-transparent outline-none text-white placeholder:text-white/30 text-sm"
                autoFocus
              />
              <button type="submit" disabled={!textInput.trim()} className="p-2 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50">
                <Send size={16} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={() => setCamera((c) => (c && c !== "screen" ? null : mobile ? "environment" : "user"))}
            className={`p-3.5 rounded-full border transition-colors ${camera && camera !== "screen" ? "bg-red-500/20 border-red-400/50 text-red-300" : "bg-white/5 border-white/10 hover:bg-white/10"}`}
            title="Show Myra your camera"
          >
            <Camera size={20} className="opacity-80" />
          </button>
          {canShareScreen && (
            <button
              onClick={() => setCamera((c) => (c === "screen" ? null : "screen"))}
              className={`p-3.5 rounded-full border transition-colors ${camera === "screen" ? "bg-red-500/20 border-red-400/50 text-red-300" : "bg-white/5 border-white/10 hover:bg-white/10"}`}
              title="Share your screen with Myra"
            >
              <MonitorUp size={20} className="opacity-80" />
            </button>
          )}

          <button
            onClick={() => { unlockAudio(); power === "awake" ? goToSleep() : wakeUp(); }}
            className={`group flex items-center gap-2.5 px-7 md:px-9 py-3.5 md:py-4 rounded-full font-semibold tracking-wide transition-all shadow-xl ${
              power === "awake"
                ? "bg-white/10 text-violet-100 border border-violet-400/40 hover:bg-white/15 backdrop-blur-md"
                : "bg-gradient-to-r from-violet-500 to-pink-500 text-white shadow-pink-500/30 hover:shadow-pink-500/50 hover:scale-[1.04] active:scale-100"
            }`}
          >
            {power === "awake" ? <><Moon size={20} /><span>Sleep</span></> : <><Sun size={20} className="group-hover:rotate-90 transition-transform" /><span>Wake up</span></>}
          </button>

          <button
            onClick={() => setShowTextInput(!showTextInput)}
            className="p-3.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
            title="Type instead"
          >
            <Keyboard size={20} className="opacity-80" />
          </button>
        </div>
      </footer>
    </div>
  );
}

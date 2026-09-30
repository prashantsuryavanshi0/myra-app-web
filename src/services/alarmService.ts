import { loadJSON, saveJSON } from "./storage";
import { getOutputCtx } from "./audioBus";

/**
 * Smart alarm: sirf bajta nahi — 2 min pehle warning, Myra ki awaaz me jagana,
 * aur agar user dismiss karke wapas so jaye toh peeche padke uthana.
 * App khula ho (screen on, tab foreground) tab reliably chalta hai.
 */
export interface Alarm {
  id: string;
  hour: number;        // 0-23
  minute: number;      // 0-59
  label: string;
  repeat: number[];    // week days 0(Sun)-6(Sat); empty = one-time
  wakeCheck: boolean;  // dismiss ke baad "sach me uth gaye?" nagging
  enabled: boolean;
  preKey?: string;     // last pre-alarm date (dedupe)
  ringKey?: string;    // last ring date (dedupe)
}

export type AlarmEvent =
  | { type: "pre"; alarm: Alarm; minsLeft: number }
  | { type: "ring"; alarm: Alarm; attempt: number }
  | { type: "wakeCheck"; alarm: Alarm; attempt: number };

const KEY = "myra_alarms";
const PRE_LEAD_MS = 2 * 60 * 1000;    // 2 minute pehle warning
const WAKE_CHECK_MS = 3 * 60 * 1000;  // dismiss ke baad itni der me dobara check
const MAX_WAKE_CHECKS = 4;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const listeners = new Set<() => void>();

export function getAlarms(): Alarm[] {
  return loadJSON<Alarm[]>(KEY, []).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}
function persist(list: Alarm[]) {
  saveJSON(KEY, list);
  listeners.forEach((fn) => fn());
}
export function onAlarmsChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function addAlarm(a: Omit<Alarm, "id" | "enabled">): Alarm {
  const alarm: Alarm = { ...a, id: crypto.randomUUID(), enabled: true };
  persist([...getAlarms(), alarm]);
  return alarm;
}
export function updateAlarm(id: string, patch: Partial<Alarm>) {
  persist(getAlarms().map((a) => (a.id === id ? { ...a, ...patch } : a)));
}
export function removeAlarm(id: string) {
  persist(getAlarms().filter((a) => a.id !== id));
}

export function describeAlarm(a: Alarm): string {
  const t = fmtTime(a.hour, a.minute);
  const rep = a.repeat.length === 0
    ? "once"
    : a.repeat.length === 7
    ? "daily"
    : isWeekdays(a.repeat)
    ? "on weekdays"
    : a.repeat.map((d) => DAYS[d].slice(0, 3)).join(", ");
  return `${t} (${rep})${a.label && a.label !== "Alarm" ? ` — ${a.label}` : ""}`;
}
function isWeekdays(r: number[]) {
  return r.length === 5 && [1, 2, 3, 4, 5].every((d) => r.includes(d));
}
export function fmtTime(h: number, m: number) {
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}`;
}
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function firesToday(a: Alarm, now: Date) {
  return a.repeat.length === 0 || a.repeat.includes(now.getDay());
}

// ─── Engine ────────────────────────────────────────────────────────────
class AlarmEngine {
  private timer: number | undefined;
  private onEvent: (e: AlarmEvent) => void = () => {};
  private sound = new AlarmSound();

  // active ring/nag state
  private active: { alarm: Alarm; attempt: number } | null = null;
  private wakeTimer: number | undefined;

  start(onEvent: (e: AlarmEvent) => void) {
    this.onEvent = onEvent;
    this.tick();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 5000);
  }
  stop() {
    window.clearInterval(this.timer);
    window.clearTimeout(this.wakeTimer);
    this.sound.stop();
  }

  private tick() {
    if (this.active) return; // already ringing/nagging
    const now = new Date();
    const today = dateKey(now);
    for (const a of getAlarms()) {
      if (!a.enabled || !firesToday(a, now)) continue;
      const alarmMs = new Date().setHours(a.hour, a.minute, 0, 0);
      const diff = alarmMs - now.getTime();

      // 2-min warning
      if (diff > 0 && diff <= PRE_LEAD_MS && a.preKey !== today) {
        updateAlarm(a.id, { preKey: today });
        this.onEvent({ type: "pre", alarm: a, minsLeft: Math.max(1, Math.round(diff / 60000)) });
        return;
      }
      // Ring: alarm time se ab tak 90s ke andar aur aaj baja nahi
      if (diff <= 0 && diff > -90000 && a.ringKey !== today) {
        updateAlarm(a.id, { ringKey: today });
        if (a.repeat.length === 0) updateAlarm(a.id, { enabled: false }); // one-time off
        this.ring(a, 1);
        return;
      }
    }
  }

  private ring(alarm: Alarm, attempt: number) {
    this.active = { alarm, attempt };
    this.sound.start();
    this.onEvent(attempt === 1 || !alarm.wakeCheck
      ? { type: "ring", alarm, attempt }
      : { type: "wakeCheck", alarm, attempt });
  }

  /** Myra bol rahi hai — beep halka karo taaki awaaz saaf sune */
  duck(on: boolean) {
    this.sound.duck(on);
  }

  snooze(minutes: number) {
    if (!this.active) return;
    const { alarm } = this.active;
    this.sound.stop();
    this.active = null;
    window.clearTimeout(this.wakeTimer);
    this.wakeTimer = window.setTimeout(() => this.ring(alarm, 1), Math.max(1, minutes) * 60000);
  }

  /** Dismiss: agar wakeCheck on hai toh thodi der baad dobara check */
  dismiss() {
    if (!this.active) return;
    const { alarm, attempt } = this.active;
    this.sound.stop();
    this.active = null;
    if (alarm.wakeCheck && attempt < MAX_WAKE_CHECKS) {
      window.clearTimeout(this.wakeTimer);
      this.wakeTimer = window.setTimeout(() => this.ring(alarm, attempt + 1), WAKE_CHECK_MS);
    }
  }

  /** User ne confirm kiya ki uth gaya — bas, peecha chhodo */
  confirmAwake() {
    this.sound.stop();
    this.active = null;
    window.clearTimeout(this.wakeTimer);
  }

  get ringing() {
    return this.active;
  }
}

// ─── Alarm sound (Web Audio se, koi file nahi) ─────────────────────────
class AlarmSound {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private loop: number | undefined;
  private ducked = false;

  start() {
    if (this.gain) return;
    try {
      this.ctx = getOutputCtx();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.vol();
      this.gain.connect(this.ctx.destination);
      const beep = () => {
        if (!this.ctx || !this.gain) return;
        [880, 0, 880, 0].forEach((f, i) => {
          if (!f) return;
          const o = this.ctx!.createOscillator();
          const g = this.ctx!.createGain();
          o.type = "sine";
          o.frequency.value = f;
          const t0 = this.ctx!.currentTime + i * 0.18;
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(1, t0 + 0.02);
          g.gain.linearRampToValueAtTime(0, t0 + 0.15);
          o.connect(g);
          g.connect(this.gain!);
          o.start(t0);
          o.stop(t0 + 0.16);
        });
      };
      beep();
      this.loop = window.setInterval(beep, 1400);
    } catch (e) {
      console.error("[Alarm sound]", e);
    }
  }
  private vol() {
    return this.ducked ? 0.04 : 0.5;
  }
  duck(on: boolean) {
    this.ducked = on;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(this.vol(), this.ctx.currentTime, 0.05);
  }
  stop() {
    window.clearInterval(this.loop);
    this.loop = undefined;
    try { this.gain?.disconnect(); } catch {}
    this.ctx = null;   // shared context, close mat karo
    this.gain = null;
    this.ducked = false;
  }
}

export const alarmEngine = new AlarmEngine();

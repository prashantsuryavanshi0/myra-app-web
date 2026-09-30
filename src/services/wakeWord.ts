import { WAKE_WORDS } from "../config";
import { DeviceControl, isNativeApp, isMobileDevice } from "../native/deviceControl";

export type WakeStatus = "listening" | "paused" | "unsupported" | "denied" | "offline";

/**
 * Sleep mode: chupchap "Hello Myra" sunti hai.
 * Laptop/phone browser → Chrome ka SpeechRecognition (Gemini quota nahi lagta)
 * Android app → Android ka SpeechRecognizer (native)
 */
export class WakeWordListener {
  onWake: (rest: string) => void = () => {};
  onStatus: (s: WakeStatus) => void = () => {};

  private rec: any = null;
  private running = false;
  private nativeSub: { remove: () => Promise<void> } | null = null;
  private restartTimer: number | undefined;
  private fired = false;

  static isSupported() {
    // Phone browser pe wake word band — mic on/off se system sound aati hai
    // Native Android app me apna wake word hai (WakeWordService), wo theek hai
    if (isNativeApp()) return true;
    if (isMobileDevice()) return false;  // phone browser pe band
    return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  /** Suna hua text me wake word hai? Hai toh uske baad wala hissa return karo.
   *  "Myra" ko Chrome alag-alag sunta hai (mira/meera/mara/maira...), isliye fuzzy match. */
  static match(text: string): string | null {
    const t = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
    if (!t) return null;
    // "myra-jaisa" = m + vowel(s) + r (+optional vowel): myra, mira, meera, maira, mara, mora, maura...
    const NAME = "m[aeiouy]{1,3}r[aeiouy]{0,2}";

    // 1. greeting + naam  → jaago, aur greeting ke baad ki command return karo
    const greet = new RegExp(`\\b(?:hello|hallo|helo|hey|hi|hai|ok|okay|hola|namaste|suno|are|are|oye)\\s+(?:${NAME})\\w*\\b`, "u");
    const gm = t.match(greet);
    if (gm && gm.index !== undefined) return t.slice(gm.index + gm[0].length).trim();

    // 2. poora vakya sirf naam ho (jaise sirf "Myra") → jaago
    if (new RegExp(`^(?:${NAME})\\w*$`, "u").test(t)) return "";

    // 3. exact listed wake words (config se), word-boundary pe
    for (const w of [...WAKE_WORDS].sort((a, b) => b.length - a.length)) {
      const m = t.match(new RegExp(`(^| )${w}( |$)`));
      if (m && m.index !== undefined) return t.slice(m.index + m[0].length).trim();
    }

    // 4. Devanagari
    const dev = text.match(/(मायरा|मीरा|माइरा|मैरा|मायरा)/);
    if (dev) return text.slice((dev.index || 0) + dev[0].length).trim();
    return null;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.fired = false;
    if (!navigator.onLine) {
      this.onStatus("offline");
      return;
    }
    if (isNativeApp()) return this.startNative();
    // Purani recognition bachi ho toh saaf karo, phir thodi der baad shuru
    // (live session ka mic free hone ka time do)
    if (this.rec) {
      const old = this.rec;
      this.rec = null;
      old.onend = null;
      try { old.abort(); } catch {}
    }
    window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => {
      if (this.running) this.startWeb();
    }, 350);
  }

  stop() {
    this.running = false;
    window.clearTimeout(this.restartTimer);
    if (isNativeApp()) {
      DeviceControl.stopWakeListener().catch(() => {});
      this.nativeSub?.remove().catch(() => {});
      this.nativeSub = null;
    } else if (this.rec) {
      const r = this.rec;
      this.rec = null;
      r.onend = null;
      try { r.abort(); } catch {}
    }
    this.onStatus("paused");
  }

  // ─── Native (Android app) ────────────────────────────────────────────
  private async startNative() {
    try {
      this.nativeSub = await DeviceControl.addListener("wake", (d) => {
        const rest = WakeWordListener.match(d.heard);
        if (rest !== null && this.running) this.onWake(rest);
      });
      await DeviceControl.startWakeListener({ words: WAKE_WORDS });
      this.onStatus("listening");
    } catch (e) {
      console.error("[Wake] native start failed", e);
      this.running = false;
      this.onStatus("denied");
    }
  }

  // ─── Web (Chrome / Edge) ─────────────────────────────────────────────
  private startWeb() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      this.running = false;
      this.onStatus("unsupported");
      return;
    }
    const rec = new SR();
    // Phone pe "hi-IN" better pakdta hai Hindi accent; en-IN fallback
    rec.lang = /android|iphone|ipad|mobile/i.test(navigator.userAgent) ? "hi-IN" : "en-IN";
    rec.continuous = true;
    rec.interimResults = true;  // interim ON — phone pe faster response
    rec.maxAlternatives = 3;    // 3 alternatives — "Myra/mira/maira" sab pakde

    let lastFired = 0;
    rec.onstart = () => { this.fired = false; this.onStatus("listening"); };
    rec.onresult = (e: any) => {
      if (this.fired) return;
      const now = Date.now();
      if (now - lastFired < 2000) return; // debounce: 2s me dobara fire nahi
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        // Interim bhi check karo (phone pe final bahut late aata hai)
        for (let k = 0; k < res.length; k++) {
          const rest = WakeWordListener.match(res[k].transcript);
          if (rest !== null) {
            lastFired = now;
            this.fired = true;
            this.onWake(rest);
            return;
          }
        }
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.running = false;
        this.onStatus("denied");
      } else if (e.error === "network") {
        this.onStatus("offline");
      }
      // "no-speech" / "aborted" normal — restart hoga
    };
    rec.onend = () => {
      if (!this.running || this.rec !== rec) return;
      // Turant restart (100ms) — phone pe gap nahi chahiye
      this.restartTimer = window.setTimeout(() => {
        if (this.running && this.rec === rec) {
          try { rec.start(); } catch {}
        }
      }, 100);
    };

    this.rec = rec;
    try {
      rec.start();
    } catch (e) {
      console.error("[Wake] start failed", e);
    }
  }
}

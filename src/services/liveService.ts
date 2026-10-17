import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { toolDeclarations, runTool, ToolOutcome } from "./tools";
import { buildSystemInstruction } from "./persona";
import { ENABLE_GOOGLE_SEARCH, LIVE_MODEL } from "../config";
import { getSettings } from "./settings";
import { getOutputCtx } from "./audioBus";

export type LiveState = "idle" | "listening" | "processing" | "speaking";

/** Gemini Live: mic → Myra → speaker, plus camera/screen frames */
export class LiveSessionManager {
  private ai: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  private playbackContext: AudioContext | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private nextPlayTime = 0;
  private stopped = false;
  public isMuted = false;

  // Transcript buffers (Live API sends text in small pieces)
  private userBuf = "";
  private modelBuf = "";

  // Video (camera/screen) → 1 frame per second
  private videoTimer: number | undefined;
  private canvas = document.createElement("canvas");

  public onStateChange: (state: LiveState) => void = () => {};
  public onMessage: (sender: "user" | "aayat", text: string) => void = () => {};
  public onOutcome: (outcome: ToolOutcome) => void = () => {};
  public onClosed: (reason: string) => void = () => {};
  /** Har baar user ya Myra bole, taaki auto-sleep timer reset ho */
  public onActivity: () => void = () => {};

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  get active() {
    return !!this.sessionPromise;
  }

  /** 0..1 — chehre ke hoth hilane ke liye */
  getOutputLevel() {
    return this.level(this.outputAnalyser);
  }
  getInputLevel() {
    return this.level(this.inputAnalyser);
  }
  private level(a: AnalyserNode | null) {
    if (!a) return 0;
    const data = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 4);
  }

  async start() {
    this.stopped = false;
    try {
      this.onStateChange("processing");
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AC({ sampleRate: 16000 });
      this.setupPlayback();

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      });

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.inputAnalyser = this.audioContext.createAnalyser();
      this.inputAnalyser.fftSize = 512;
      this.source.connect(this.inputAnalyser);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.sessionPromise) return;
        const input = e.inputBuffer.getChannelData(0);
        const bytes = new Uint8Array(input.length * 2);
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        const data = btoa(binary);
        this.sessionPromise
          .then((s) => s.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } }))
          .catch(() => {});
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      const settings = getSettings();
      this.sessionPromise = this.ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice } } },
          systemInstruction: buildSystemInstruction(),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [
            ...(ENABLE_GOOGLE_SEARCH ? [{ googleSearch: {} }] : []),
            { functionDeclarations: toolDeclarations },
          ],
        },
        callbacks: {
          onopen: () => {
            console.log("Live API Connected");
            this.onStateChange("listening");
          },
          onmessage: (m: LiveServerMessage) => this.handleMessage(m),
          onclose: (e: any) => {
            console.log("Live API Closed", e?.code, e?.reason);
            const reason = e?.reason || "";
            this.stop();
            this.onClosed(reason);
          },
          onerror: (err: any) => {
            console.error("Live API Error:", err);
            if (err?.message) {
              this.stop();
              this.onClosed(String(err.message));
            }
            // agar message nahi toh stop mat karo — onclose asli reason ke saath aayega
          },
        },
      });
      await this.sessionPromise;
    } catch (error: any) {
      console.error("Failed to start Live Session:", error);
      this.stop();
      this.onClosed(String(error?.message || "start failed"));
    }
  }

  private async handleMessage(message: LiveServerMessage) {
    const sc = message.serverContent;

    for (const part of sc?.modelTurn?.parts || []) {
      const audio = part.inlineData?.data;
      if (audio) {
        this.onStateChange("speaking");
        this.onActivity();
        this.playAudioChunk(audio);
      }
    }

    if (sc?.interrupted) {
      this.resetPlayback();
      this.onStateChange("listening");
    }

    if (sc?.inputTranscription?.text) {
      this.userBuf += sc.inputTranscription.text;
      this.onActivity();
    }
    if (sc?.outputTranscription?.text) {
      if (this.userBuf.trim()) this.flushUser();
      this.modelBuf += sc.outputTranscription.text;
    }
    if (sc?.turnComplete) {
      this.flushUser();
      if (this.modelBuf.trim()) this.onMessage("aayat", this.modelBuf.trim());
      this.modelBuf = "";
    }

    const calls = message.toolCall?.functionCalls;
    if (calls?.length) {
      this.flushUser();
      this.onStateChange("processing");
      this.onActivity();
      const functionResponses = [];
      for (const call of calls) {
        const outcome = await runTool(call.name || "", call.args);
        this.onOutcome(outcome);
        functionResponses.push({ name: call.name, id: call.id, response: { result: outcome.result } });
      }
      this.sessionPromise?.then((s) => s.sendToolResponse({ functionResponses })).catch(() => {});
    }
  }

  private flushUser() {
    if (this.userBuf.trim()) this.onMessage("user", this.userBuf.trim());
    this.userBuf = "";
  }

  private setupPlayback() {
    this.playbackContext = getOutputCtx();  // shared, unlocked context
    this.outputAnalyser = this.playbackContext.createAnalyser();
    this.outputAnalyser.fftSize = 512;
    this.outputAnalyser.connect(this.playbackContext.destination);
    this.nextPlayTime = this.playbackContext.currentTime;
  }

  private playAudioChunk(base64: string) {
    if (!this.playbackContext || !this.outputAnalyser || this.isMuted) return;
    try {
      if (this.playbackContext.state === "suspended") this.playbackContext.resume().catch(() => {});
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pcm = new Int16Array(bytes.buffer);
      const buf = this.playbackContext.createBuffer(1, pcm.length, 24000);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;

      const src = this.playbackContext.createBufferSource();
      src.buffer = buf;
      src.connect(this.outputAnalyser);
      const now = this.playbackContext.currentTime;
      if (this.nextPlayTime < now) this.nextPlayTime = now;
      src.start(this.nextPlayTime);
      this.nextPlayTime += buf.duration;
      src.onended = () => {
        if (this.playbackContext && this.playbackContext.currentTime >= this.nextPlayTime - 0.1) {
          this.onActivity();
          this.onStateChange("listening");
        }
      };
    } catch (e) {
      console.error("Error playing chunk", e);
    }
  }

  /** Myra ka bolna khatam hone me kitne ms bache */
  msUntilSilent() {
    if (!this.playbackContext) return 0;
    return Math.max(0, (this.nextPlayTime - this.playbackContext.currentTime) * 1000);
  }

  private resetPlayback() {
    // shared context close mat karo — sirf awaaz ka rasta kaato aur naya analyser
    try { this.outputAnalyser?.disconnect(); } catch {}
    if (this.playbackContext) {
      this.outputAnalyser = this.playbackContext.createAnalyser();
      this.outputAnalyser.fftSize = 512;
      this.outputAnalyser.connect(this.playbackContext.destination);
      this.nextPlayTime = this.playbackContext.currentTime;
    }
  }

  // ─── Camera / screen frames ───────────────────────────────────────────
  attachVideo(video: HTMLVideoElement | null) {
    window.clearInterval(this.videoTimer);
    if (!video) return;
    this.videoTimer = window.setInterval(() => {
      if (!this.sessionPromise || !video.videoWidth) return;
      const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
      this.canvas.width = Math.round(video.videoWidth * scale);
      this.canvas.height = Math.round(video.videoHeight * scale);
      const ctx = this.canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      const data = this.canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
      this.sessionPromise.then((s) => s.sendRealtimeInput({ video: { data, mimeType: "image/jpeg" } })).catch(() => {});
    }, 1000);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    window.clearInterval(this.videoTimer);
    // pehle processor aur source disconnect (mic se audio lena band)
    this.processor?.disconnect();
    if (this.processor) { try { this.processor.onaudioprocess = null; } catch {} }
    this.processor = null;
    this.source?.disconnect();
    this.source = null;
    this.inputAnalyser?.disconnect();
    this.inputAnalyser = null;
    // phir mic tracks stop (hardware mic release)
    this.mediaStream?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    this.mediaStream = null;
    // ab context close
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    try { this.outputAnalyser?.disconnect(); } catch {}
    this.playbackContext = null;   // shared context, close mat karo
    this.outputAnalyser = null;
    if (this.sessionPromise) {
      this.sessionPromise.then((s) => s.close()).catch(() => {});
      this.sessionPromise = null;
    }
    this.userBuf = "";
    this.modelBuf = "";
    this.onStateChange("idle");
  }

  sendText(text: string) {
    this.sessionPromise?.then((s) => s.sendRealtimeInput({ text })).catch(() => {});
  }
}

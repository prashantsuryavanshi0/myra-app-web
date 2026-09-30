/**
 * Ek hi output AudioContext jo pehle user tap pe unlock hota hai aur reuse hota hai.
 * Isse alarm/notification jaise timer se bajne wale audio bina naye tap ke bhi bajte hain
 * (browser naye context ko bina gesture ke block karta hai, isliye purana hi reuse karte hain).
 */
let ctx: AudioContext | null = null;

export function getOutputCtx(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Har user tap/click pe call karo taaki context pakka unlock rahe */
export function unlockAudio() {
  try {
    const c = getOutputCtx();
    if (c.state === "suspended") c.resume().catch(() => {});
    // ek silent blip — kuch browsers ko "activate" karta hai
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
  } catch {}
}

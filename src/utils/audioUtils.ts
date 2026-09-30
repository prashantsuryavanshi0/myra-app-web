import { getOutputCtx } from "../services/audioBus";

/** TTS PCM (24kHz) bajao — shared unlocked context se (timer se bhi bajta hai) */
export async function playPCM(base64Data: string): Promise<void> {
  try {
    const audioCtx = getOutputCtx();
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const pcm = new Int16Array(bytes.buffer);
    const audioBuffer = audioCtx.createBuffer(1, pcm.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channelData[i] = pcm[i] / 32768.0;
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start();
    return new Promise<void>((resolve) => { source.onended = () => resolve(); });
  } catch (error) {
    console.error("[Audio playback]", error);
  }
}

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { X, SwitchCamera } from "lucide-react";

export type CameraMode = "user" | "environment" | "screen";

interface Props {
  mode: CameraMode;
  onVideo: (el: HTMLVideoElement | null) => void;
  onFlip: () => void;
  onClose: () => void;
}

/** Camera ya screen ka chhota preview; frames Myra ko jaate hain */
export default function CameraView({ mode, onVideo, onFlip, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        stream =
          mode === "screen"
            ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
            : await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: { ideal: 1280 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        onVideo(v);
        // Screen share browser se band kiya toh preview bhi band
        stream.getVideoTracks()[0].onended = () => onClose();
      } catch (e: any) {
        setError(mode === "screen" ? "Screen share cancelled." : "Camera permission blocked.");
        onVideo(null);
      }
    })();
    return () => {
      cancelled = true;
      onVideo(null);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="fixed z-30 left-3 top-16 md:left-8 md:top-20 w-40 md:w-60 rounded-2xl overflow-hidden border border-white/15 bg-black shadow-2xl"
    >
      <video ref={video} muted playsInline className={`w-full aspect-video object-cover ${mode === "user" ? "-scale-x-100" : ""}`} />
      {error && <p className="absolute inset-0 flex items-center justify-center text-xs text-center p-2 bg-black/80">{error}</p>}
      <div className="absolute top-1 right-1 flex gap-1">
        {mode !== "screen" && (
          <button onClick={onFlip} className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80" aria-label="Flip camera"><SwitchCamera size={14} /></button>
        )}
        <button onClick={onClose} className="p-1.5 rounded-lg bg-black/60 hover:bg-black/80" aria-label="Stop"><X size={14} /></button>
      </div>
      <span className="absolute bottom-1 left-1.5 text-[10px] px-1.5 py-0.5 rounded bg-red-500/80">● {mode === "screen" ? "Screen" : "Camera"}</span>
    </motion.div>
  );
}

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { X, ExternalLink } from "lucide-react";
import type { MediaItem, MediaCommand } from "../services/tools";

interface Props {
  media: MediaItem;
  command: { type: MediaCommand; nonce: number } | null;
  onClose: () => void;
}

const FUNCS: Partial<Record<MediaCommand, string>> = {
  play: "playVideo",
  pause: "pauseVideo",
  mute: "mute",
  unmute: "unMute",
};

/** Website pe gaana app ke andar hi chalta hai (popup blocker ka jhanjhat nahi) */
export default function YouTubePlayer({ media, command, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!command) return;
    if (command.type === "stop") return onClose();
    const func = FUNCS[command.type];
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
  }, [command, onClose]);

  const origin = encodeURIComponent(window.location.origin);
  const src = `https://www.youtube.com/embed/${media.videoId}?autoplay=1&enablejsapi=1&playsinline=1&rel=0&origin=${origin}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      className="fixed z-40 right-3 top-16 md:top-20 md:right-8 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl overflow-hidden bg-black border border-white/15 shadow-2xl"
    >
      <div className="aspect-video bg-black">
        <iframe
          ref={frame}
          src={src}
          title={media.title}
          className="w-full h-full"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <p className="flex-1 min-w-0 text-sm truncate" title={media.title}>{media.title}</p>
        <a
          href={`https://www.youtube.com/watch?v=${media.videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"
          title="Open in YouTube"
        >
          <ExternalLink size={16} />
        </a>
        <button onClick={onClose} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" aria-label="Close player">
          <X size={16} />
        </button>
      </div>
    </motion.div>
  );
}

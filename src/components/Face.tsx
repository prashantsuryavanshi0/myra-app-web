import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

export type FaceState = "off" | "sleeping" | "waking" | "listening" | "processing" | "speaking";

interface Props {
  state: FaceState;
  getLevel?: () => number;
  getMicLevel?: () => number;
}

export default function Face({ state, getLevel, getMicLevel }: Props) {
  const [mouth, setMouth] = useState(0);
  const [mic, setMic] = useState(0);
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    const active = state === "speaking" || state === "listening";
    if (!active) { setMouth(0); setMic(0); return; }
    let last = 0;
    const tick = (now: number) => {
      raf.current = requestAnimationFrame(tick);
      if (now - last < 40) return; last = now;
      if (state === "speaking") setMouth(m => m + (Math.min(1, (getLevel?.() || 0) * 2) - m) * 0.35);
      else setMic(m => m + (Math.min(1, (getMicLevel?.() || 0) * 2) - m) * 0.35);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [state, getLevel, getMicLevel]);

  const asleep = state === "sleeping" || state === "off";
  const level  = state === "speaking" ? mouth : state === "listening" ? mic : 0;

  // Color theme per state
  const themes = {
    off:        { a: "#3b0764", b: "#1e1b4b", ring: "#6d28d9", center: "#7c3aed" },
    sleeping:   { a: "#4c1d95", b: "#1e1b4b", ring: "#7c3aed", center: "#a855f7" },
    waking:     { a: "#86198f", b: "#4a044e", ring: "#d946ef", center: "#e879f9" },
    listening:  { a: "#0e7490", b: "#083344", ring: "#22d3ee", center: "#67e8f9" },
    processing: { a: "#92400e", b: "#451a03", ring: "#f59e0b", center: "#fcd34d" },
    speaking:   { a: "#831843", b: "#4a044e", ring: "#ec4899", center: "#f472b6" },
  };
  const t = themes[state];

  return (
    <div className="relative w-64 h-64 md:w-80 md:h-80 flex items-center justify-center select-none">

      {/* Outer ambient glow */}
      <motion.div className="absolute inset-0 rounded-full"
        style={{ background: `radial-gradient(circle, ${t.ring}22 0%, transparent 70%)` }}
        animate={{ scale: [1, 1.12, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: asleep ? 4 : 2.5, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Rotating outer ring */}
      <motion.div className="absolute rounded-full border"
        style={{ inset: "6%", borderColor: t.ring, borderWidth: 1, opacity: 0.3 }}
        animate={{ rotate: 360 }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      />
      <motion.div className="absolute rounded-full border"
        style={{ inset: "10%", borderColor: t.center, borderWidth: 1, opacity: 0.2 }}
        animate={{ rotate: -360 }}
        transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
      />

      {/* Main SVG orb */}
      <svg viewBox="0 0 240 240" className="relative w-full h-full">
        <defs>
          <radialGradient id="orb" cx="40%" cy="32%" r="68%">
            <stop offset="0%"   stopColor={t.center} stopOpacity=".9"/>
            <stop offset="40%"  stopColor={t.a}/>
            <stop offset="100%" stopColor={t.b}/>
          </radialGradient>
          <radialGradient id="glow" cx="38%" cy="30%" r="55%">
            <stop offset="0%"   stopColor="#ffffff" stopOpacity=".5"/>
            <stop offset="50%"  stopColor="#ffffff" stopOpacity=".08"/>
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
          </radialGradient>
          <filter id="blur4">
            <feGaussianBlur stdDeviation="4"/>
          </filter>
          <filter id="blur2">
            <feGaussianBlur stdDeviation="2"/>
          </filter>
          <clipPath id="orbClip">
            <circle cx="120" cy="120" r="96"/>
          </clipPath>
        </defs>

        {/* Drop shadow */}
        <circle cx="120" cy="130" r="90" fill={t.b} filter="url(#blur4)" opacity=".5"/>

        {/* Main orb body */}
        <circle cx="120" cy="120" r="96" fill="url(#orb)"/>

        {/* Inner glow */}
        <circle cx="120" cy="120" r="96" fill="url(#glow)"/>

        {/* ── WAVES inside orb (clipped) ── */}
        <g clipPath="url(#orbClip)">
          {state === "listening" || state === "speaking" ? (
            /* Active — animated waves */
            <>
              {[0, 1, 2].map(i => {
                const amp  = 18 + level * 32 + i * 8;
                const freq = 1.2 + i * 0.4;
                const col  = [t.center, "#ffffff", t.ring][i];
                const op   = [0.85, 0.5, 0.35][i];
                const sw   = [3.5, 2.5, 1.8][i];
                const pts  = Array.from({length: 13}, (_, k) => {
                  const x = 24 + k * 16;
                  const y = 120 + Math.sin((k / 12) * Math.PI * 2 * freq) * amp;
                  return `${k === 0 ? "M" : "L"}${x} ${y}`;
                }).join(" ");
                return (
                  <motion.path key={i} d={pts}
                    stroke={col} strokeWidth={sw} fill="none"
                    strokeLinecap="round" opacity={op}
                    animate={{ d: [
                      pts,
                      Array.from({length:13},(_,k)=>{
                        const x=24+k*16;
                        const y=120+Math.sin((k/12)*Math.PI*2*freq+Math.PI)*amp;
                        return `${k===0?"M":"L"}${x} ${y}`;
                      }).join(" "),
                      pts
                    ]}}
                    transition={{duration: 1.2 - i * 0.15, repeat: Infinity, ease: "easeInOut"}}
                  />
                );
              })}
            </>
          ) : asleep ? (
            /* Sleeping — slow gentle wave */
            <motion.path
              stroke={t.ring} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".35"
              animate={{ d: [
                "M24 120 Q60 108 96 120 Q132 132 168 120 Q192 112 216 120",
                "M24 120 Q60 132 96 120 Q132 108 168 120 Q192 128 216 120",
                "M24 120 Q60 108 96 120 Q132 132 168 120 Q192 112 216 120",
              ]}}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : (
            /* Idle/waking — medium pulse wave */
            <motion.path
              stroke={t.center} strokeWidth="3" fill="none" strokeLinecap="round" opacity=".5"
              animate={{ d: [
                "M24 120 Q60 104 96 120 Q132 136 168 120 Q192 108 216 120",
                "M24 120 Q60 136 96 120 Q132 104 168 120 Q192 132 216 120",
                "M24 120 Q60 104 96 120 Q132 136 168 120 Q192 108 216 120",
              ]}}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </g>

        {/* Center pulse */}
        <motion.circle cx="120" cy="120"
          r={state === "speaking" ? 14 + mouth * 20 : state === "listening" ? 12 + mic * 16 : 10}
          fill={t.center} opacity=".35" filter="url(#blur2)"
          animate={{ r: state==="speaking" ? undefined : [10, 16, 10] }}
          transition={{ duration: asleep ? 4 : 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle cx="120" cy="120"
          r={state === "speaking" ? 8 + mouth * 10 : 7}
          fill={t.center} opacity=".7"
          animate={{ r: state==="speaking" ? undefined : [7, 11, 7] }}
          transition={{ duration: asleep ? 4 : 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <circle cx="120" cy="120" r="4" fill="white" opacity=".9"/>

        {/* Highlight */}
        <ellipse cx="96" cy="82" rx="26" ry="16" fill="white" opacity=".18"/>
        <ellipse cx="92" cy="78" rx="12" ry="7" fill="white" opacity=".16"/>

        {/* Floating particles */}
        {[
          {cx:64, cy:70, r:3, c:t.center, d:8},
          {cx:186, cy:66, r:2.5, c:t.ring, d:12},
          {cx:54, cy:168, r:2, c:"#22d3ee", d:6},
          {cx:196, cy:178, r:2.8, c:t.center, d:10},
          {cx:76, cy:196, r:2.2, c:t.ring, d:9},
          {cx:178, cy:192, r:2, c:"#f472b6", d:7},
        ].map((p, i) => (
          <motion.circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.c}
            animate={{ cy:[p.cy, p.cy - p.d, p.cy], opacity:[.5,.9,.5] }}
            transition={{ duration: 2.5 + i * 0.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.5 }}
          />
        ))}

        {/* M lettermark — subtle, center */}
        <text x="120" y="127" textAnchor="middle" fontSize="22" fontWeight="700"
          fontFamily="Georgia, serif" fill="white" opacity=".18" letterSpacing="1">M</text>
      </svg>

      {/* Zzz */}
      <AnimatePresence>
        {state === "sleeping" && [0,1,2].map(i => (
          <motion.span key={i}
            className="absolute text-violet-300/70 font-serif font-bold pointer-events-none"
            style={{ right:"10%", top:"12%", fontSize: 15 + i * 7 }}
            initial={{ opacity:0, y:0, x:0 }}
            animate={{ opacity:[0,1,0], y:-65, x:26 }}
            exit={{ opacity:0 }}
            transition={{ duration: 3, delay: i * 1.1, repeat: Infinity }}>
            z
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

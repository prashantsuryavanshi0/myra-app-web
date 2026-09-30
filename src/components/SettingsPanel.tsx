import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { X, Brain, Trash2, Plus, Ear, Moon, Sparkles, Mic2, Bell } from "lucide-react";
import { getSettings, updateSettings, onSettingsChange, MODES, VOICES, PersonalityMode, Settings } from "../services/settings";
import { getMemories, remember, deleteMemory, onMemoriesChange, Memory } from "../services/memory";
import { isNativeApp } from "../native/deviceControl";
import { ASSISTANT_NAME } from "../config";

interface Props {
  onClose: () => void;
  /** mode ya voice badla: chalu session naye setting se restart */
  onNeedsRestart: () => void;
}

export default function SettingsPanel({ onClose, onNeedsRestart }: Props) {
  const [s, setS] = useState<Settings>(getSettings);
  const [mems, setMems] = useState<Memory[]>(getMemories);
  const [newMem, setNewMem] = useState("");

  useEffect(() => onSettingsChange(setS), []);
  useEffect(() => onMemoriesChange(() => setMems(getMemories())), []);

  const set = (patch: Partial<Settings>, restart = false) => {
    updateSettings(patch);
    if (restart) onNeedsRestart();
  };

  const Section = ({ icon, title, children }: any) => (
    <section className="py-4 border-b border-white/5">
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">{icon}{title}</h3>
      {children}
    </section>
  );

  const Toggle = ({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) => (
    <label className="flex items-start justify-between gap-3 py-1.5 cursor-pointer">
      <span>
        <span className="text-sm">{label}</span>
        {hint && <span className="block text-xs text-white/50 mt-0.5 leading-relaxed">{hint}</span>}
      </span>
      <button
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${on ? "bg-violet-500" : "bg-white/15"}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-[#0d0d12] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl px-5 pt-5 pb-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{ASSISTANT_NAME} settings</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10" aria-label="Close"><X size={18} /></button>
        </div>

        <Section icon={<Sparkles size={16} className="text-pink-300" />} title="Personality">
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(MODES) as PersonalityMode[]).map((m) => (
              <button
                key={m}
                onClick={() => set({ mode: m }, true)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs transition-colors ${
                  s.mode === m ? "bg-violet-500/25 border-violet-400/60" : "bg-white/5 border-white/10 hover:bg-white/10"
                }`}
              >
                <span className="text-lg">{MODES[m].emoji}</span>
                {MODES[m].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/45 mt-2">Or just say “sweet mode on karo” / “English practice karao”.</p>
        </Section>

        <Section icon={<Mic2 size={16} className="text-cyan-300" />} title="Voice">
          <select
            value={s.voice}
            onChange={(e) => set({ voice: e.target.value }, true)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
          >
            {VOICES.map((v) => <option key={v.id} value={v.id} className="bg-[#111]">{v.label}</option>)}
          </select>
        </Section>

        <Section icon={<Ear size={16} className="text-violet-300" />} title="Wake & sleep">
          <Toggle
            on={s.wakeEnabled}
            onChange={(v) => set({ wakeEnabled: v })}
            label={`Listen for “Hello ${ASSISTANT_NAME}”`}
            hint="While sleeping, she only listens for her name. This does not use your Gemini quota."
          />
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm flex items-center gap-2"><Moon size={14} /> Auto-sleep when quiet</span>
            <select
              value={s.autoSleepSeconds}
              onChange={(e) => set({ autoSleepSeconds: Number(e.target.value) })}
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-sm outline-none"
            >
              {[[0, "Never (recommended)"], [120, "2 min"], [300, "5 min"], [600, "10 min"]].map(([v, l]) => (
                <option key={v} value={v} className="bg-[#111]">{l}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-white/45 mt-1">Sleep by voice: “bye {ASSISTANT_NAME}”, “so jao”, “good night”.</p>
        </Section>

        {isNativeApp() && (
          <Section icon={<Bell size={16} className="text-amber-300" />} title="Announcements">
            <Toggle on={s.announceCalls} onChange={(v) => set({ announceCalls: v })} label="Tell me who's calling" />
            <Toggle on={s.announceMessages} onChange={(v) => set({ announceMessages: v })} label="Read out new messages" hint="Needs notification access (Setup screen)." />
          </Section>
        )}

        <Section icon={<Brain size={16} className="text-emerald-300" />} title={`What ${ASSISTANT_NAME} remembers`}>
          <div className="flex gap-2 mb-2">
            <input
              value={newMem}
              onChange={(e) => setNewMem(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newMem.trim()) { remember(newMem); setNewMem(""); } }}
              placeholder="e.g. My birthday is 12 March"
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
            <button
              onClick={() => { if (newMem.trim()) { remember(newMem); setNewMem(""); } }}
              className="p-2.5 rounded-xl bg-white text-black"
              aria-label="Add memory"
            >
              <Plus size={16} />
            </button>
          </div>
          {mems.length === 0 && <p className="text-xs text-white/45">Nothing yet. Say “yaad rakhna mujhe paneer pasand hai”.</p>}
          <div className="space-y-1">
            {[...mems].reverse().map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-2 py-1.5">
                <p className="text-sm text-white/85">{m.text}</p>
                <button onClick={() => deleteMemory(m.id)} className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10" aria-label="Forget">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </Section>
      </motion.div>
    </div>
  );
}

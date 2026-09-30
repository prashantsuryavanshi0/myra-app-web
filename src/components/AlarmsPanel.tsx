import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { X, Plus, Trash2, AlarmClock, Bell, BellOff } from "lucide-react";
import { getAlarms, addAlarm, removeAlarm, updateAlarm, describeAlarm, onAlarmsChange, Alarm } from "../services/alarmService";
import { isNativeApp } from "../native/deviceControl";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

interface Props {
  onClose: () => void;
}

export default function AlarmsPanel({ onClose }: Props) {
  const [alarms, setAlarms] = useState<Alarm[]>(getAlarms);
  const [time, setTime] = useState("06:30");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [wakeCheck, setWakeCheck] = useState(true);

  useEffect(() => onAlarmsChange(() => setAlarms(getAlarms())), []);

  const add = () => {
    const [h, m] = time.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return;
    addAlarm({ hour: h, minute: m, label: label.trim() || "Alarm", repeat: [...days].sort(), wakeCheck });
    setLabel("");
  };

  const toggleDay = (d: number) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-[#0d0d12] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl px-5 pt-5 pb-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2"><AlarmClock size={20} className="text-violet-300" /> Alarms</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10" aria-label="Close"><X size={18} /></button>
        </div>

        {/* Add new */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-lg font-semibold outline-none focus:border-violet-400 [color-scheme:dark]"
            />
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (gym, office…)"
              className="flex-1 min-w-0 bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
          </div>
          <div className="flex gap-1.5 mb-3">
            {DAYS.map((d, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                className={`w-8 h-8 rounded-full text-xs font-semibold transition-colors ${days.includes(i) ? "bg-violet-500 text-white" : "bg-white/10 text-white/60 hover:bg-white/20"}`}
              >
                {d}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between cursor-pointer mb-3">
            <span className="text-sm text-white/80">Keep waking me till I'm up</span>
            <button
              onClick={() => setWakeCheck(!wakeCheck)}
              className={`w-11 h-6 rounded-full relative transition-colors ${wakeCheck ? "bg-violet-500" : "bg-white/15"}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${wakeCheck ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </label>
          <button onClick={add} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-black font-semibold">
            <Plus size={16} /> Add alarm
          </button>
        </div>

        {/* List */}
        {alarms.length === 0 ? (
          <p className="text-sm text-white/45 text-center py-4">No alarms yet. Add one above, or say “alarm laga do 6 baje ka”.</p>
        ) : (
          <div className="space-y-2">
            {alarms.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                <div>
                  <p className={`text-base font-semibold ${a.enabled ? "" : "text-white/40 line-through"}`}>{describeAlarm(a)}</p>
                  {a.wakeCheck && <p className="text-[11px] text-violet-300/70">wakes you till you're up</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateAlarm(a.id, { enabled: !a.enabled })}
                    className="p-2 rounded-lg text-white/60 hover:bg-white/10"
                    title={a.enabled ? "Turn off" : "Turn on"}
                  >
                    {a.enabled ? <Bell size={16} /> : <BellOff size={16} />}
                  </button>
                  <button onClick={() => removeAlarm(a.id)} className="p-2 rounded-lg text-white/50 hover:text-red-400 hover:bg-red-500/10" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!isNativeApp() && (
          <p className="text-[11px] text-white/40 mt-4 leading-relaxed">
            On the website, alarms ring while this tab is open. Keep Myra open by your bed, or install the Android app for background alarms.
          </p>
        )}
      </motion.div>
    </div>
  );
}

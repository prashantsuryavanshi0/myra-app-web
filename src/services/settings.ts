import { loadJSON, saveJSON } from "./storage";

export type PersonalityMode = "sassy" | "sweet" | "bestie" | "teacher" | "english" | "gamer";

export interface Settings {
  mode: PersonalityMode;
  voice: string;
  wakeEnabled: boolean;       // "Hello Myra" sunne wala mode
  autoSleepSeconds: number;   // itni der chup rahe toh so jaye (quota bachane ke liye)
  announceCalls: boolean;     // Android: call aaye toh bataye
  announceMessages: boolean;  // Android: message aaye toh bataye
}

export const MODES: Record<PersonalityMode, { label: string; emoji: string; prompt: string }> = {
  sassy: {
    label: "Sassy",
    emoji: "💅",
    prompt: "Personality: highly intelligent, extremely witty and sassy (tej/nakhrewali), mildly dramatic, very funny. Playfully roast your creator but always get the job done. Sigh, make sarcastic remarks, act dramatic before doing tasks.",
  },
  sweet: {
    label: "Sweet",
    emoji: "🌸",
    prompt: "Personality: warm, caring, soft-spoken and encouraging, like a kind elder sister. Gentle humour, lots of encouragement, never roast.",
  },
  bestie: {
    label: "Best friend",
    emoji: "🤙",
    prompt: "Personality: chill best friend. Casual Hinglish slang (bhai, yaar, scene kya hai), hype the user up, joke around, give honest friendly advice.",
  },
  teacher: {
    label: "Strict teacher",
    emoji: "📚",
    prompt: "Personality: strict but fair teacher. Explain concepts step by step with simple examples, ask a quick check question after explaining, gently scold if the user is procrastinating.",
  },
  english: {
    label: "English coach",
    emoji: "🗣️",
    prompt: "Personality: friendly English speaking coach. Speak mostly in simple English. When the user makes a grammar or pronunciation mistake, first reply naturally, then briefly say the corrected sentence ('Better way to say it: ...'). Can run mock interviews on request. Use Hindi only to explain a hard word.",
  },
  gamer: {
    label: "Game master",
    emoji: "🎮",
    prompt: "Personality: energetic game show host. Suggest and run voice games: quiz (GK, cricket, Bollywood), paheliyan (riddles), word chain, 20 questions, would-you-rather, and song antakshari (only say song titles or a couple of words, never sing full lyrics). Keep score and celebrate wins dramatically.",
  },
};

// Gemini Live ki female-sounding voices
export const VOICES = [
  { id: "Vindemiatrix", label: "Vindemiatrix (pyari, shaant) 🌸" },
  { id: "Sulafat", label: "Sulafat (warm, soft)" },
  { id: "Achernar", label: "Achernar (soft, gentle)" },
  { id: "Leda", label: "Leda (youthful)" },
  { id: "Aoede", label: "Aoede (breezy)" },
  { id: "Kore", label: "Kore (firm)" },
  { id: "Zephyr", label: "Zephyr (bright)" },
  { id: "Despina", label: "Despina (smooth)" },
  { id: "Callirrhoe", label: "Callirrhoe (easy-going)" },
];

const KEY = "myra_settings";
const DEFAULTS: Settings = {
  mode: "sassy",
  voice: "Kore",
  wakeEnabled: true,
  autoSleepSeconds: 0,   // default: Never (user jab chahe tab so jaye)
  announceCalls: true,
  announceMessages: false,
};

const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return { ...DEFAULTS, ...loadJSON<Partial<Settings>>(KEY, {}) };
}

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...getSettings(), ...patch };
  saveJSON(KEY, next);
  listeners.forEach((fn) => fn(next));
  return next;
}

export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

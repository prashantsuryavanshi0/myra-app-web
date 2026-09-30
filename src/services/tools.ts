import { Type, FunctionDeclaration } from "@google/genai";
import {
  resolveContact,
  cleanDialNumber,
  toWhatsAppNumber,
  addContact,
  getContacts,
} from "./contactsService";
import { loadJSON, saveJSON } from "./storage";
import { DeviceControl, isNativeApp, isMobileDevice } from "../native/deviceControl";
import { remember, forget, getMemories } from "./memory";
import { updateSettings, MODES, PersonalityMode } from "./settings";
import { addAlarm, getAlarms, removeAlarm, describeAlarm, fmtTime, alarmEngine, Alarm } from "./alarmService";

// ─── Types ──────────────────────────────────────────────────────────────
export type ActionIcon =
  | "call" | "sms" | "whatsapp" | "youtube" | "music" | "web" | "search" | "maps" | "email";

/** Website pe: ek action jo auto-open hoga, na ho paye toh button se */
export interface PendingAction {
  url: string;
  label: string;
  icon: ActionIcon;
  phone?: string;     // laptop pe call/SMS ke liye QR code
  copyText?: string;  // laptop pe "copy message"
}

export interface MediaItem {
  videoId: string;
  title: string;
}

export type MediaCommand = "play" | "pause" | "stop" | "mute" | "unmute";

export interface ToolOutcome {
  result: string;               // model ko bataya jayega
  sleep?: boolean;              // Myra ko sleep mode me bhejo
  restartSession?: boolean;     // mode/voice badla: session naye setting se dobara
  camera?: "on" | "off" | "flip";
  action?: PendingAction;       // website pe button/auto-open
  media?: MediaItem;            // website pe in-app YouTube player
  mediaCommand?: MediaCommand;  // in-app player control
}

// ─── Tool declarations (Gemini ko batate hain ki wo kya kya kar sakti hai) ──
const str = (description: string) => ({ type: Type.STRING, description });

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "play_youtube",
    description: "Play/search a song or video on YouTube. Use for 'YouTube pe X chalao', 'X gaana bajao'.",
    parameters: { type: Type.OBJECT, properties: { query: str("Song or video name, with artist if known") }, required: ["query"] },
  },
  {
    name: "play_spotify",
    description: "Search/play music on Spotify, only when the user mentions Spotify.",
    parameters: { type: Type.OBJECT, properties: { query: str("Song, artist or playlist") }, required: ["query"] },
  },
  {
    name: "open_app_or_website",
    description: "Open a website or app by name, e.g. Instagram, Gmail, Amazon, Netflix, or any domain.",
    parameters: { type: Type.OBJECT, properties: { name: str("App/site name or URL") }, required: ["name"] },
  },
  {
    name: "google_search",
    description: "Open Google search results in the browser for the user to see.",
    parameters: { type: Type.OBJECT, properties: { query: str("Search query") }, required: ["query"] },
  },
  {
    name: "open_maps",
    description: "Show a place or get directions on Google Maps.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        destination: str("Place to go or search"),
        mode: str("'driving', 'walking', 'transit' or 'two-wheeler'. Optional."),
      },
      required: ["destination"],
    },
  },
  {
    name: "make_call",
    description: "Phone call a saved contact by name, or a phone number.",
    parameters: { type: Type.OBJECT, properties: { contact: str("Contact name exactly as the user said it, or a phone number") }, required: ["contact"] },
  },
  {
    name: "send_sms",
    description: "Send a normal SMS text message to a contact name or number.",
    parameters: {
      type: Type.OBJECT,
      properties: { contact: str("Contact name or phone number"), message: str("Message text to send") },
      required: ["contact", "message"],
    },
  },
  {
    name: "send_whatsapp",
    description: "Send a WhatsApp message to a contact name or number.",
    parameters: {
      type: Type.OBJECT,
      properties: { contact: str("Contact name or phone number"), message: str("Message text to send") },
      required: ["contact", "message"],
    },
  },
  {
    name: "send_email",
    description: "Compose an email.",
    parameters: {
      type: Type.OBJECT,
      properties: { to: str("Email address"), subject: str("Subject"), body: str("Email body") },
      required: ["to", "body"],
    },
  },
  {
    name: "save_contact",
    description: "Save a new contact (name + phone number) so it can be called/messaged by name later.",
    parameters: {
      type: Type.OBJECT,
      properties: { name: str("Contact name"), phone: str("Phone number") },
      required: ["name", "phone"],
    },
  },
  {
    name: "list_contacts",
    description: "List the saved contact names.",

  },
  {
    name: "set_reminder",
    description: "Set a reminder or timer that goes off after some minutes (use decimals for seconds, e.g. 0.5).",
    parameters: {
      type: Type.OBJECT,
      properties: { text: str("What to remind about"), minutes: { type: Type.NUMBER, description: "Minutes from now" } },
      required: ["text", "minutes"],
    },
  },
  {
    name: "save_note",
    description: "Save a note / yaad rakhna. Use when user says 'yaad rakhna', 'note kar lo'.",
    parameters: { type: Type.OBJECT, properties: { text: str("Note text") }, required: ["text"] },
  },
  {
    name: "read_notes",
    description: "Read back the saved notes.",

  },
  {
    name: "get_device_status",
    description: "Get battery level, charging status, internet status, current date and time.",

  },
  {
    name: "get_location",
    description: "Find the user's current location (area/city).",

  },
  {
    name: "toggle_flashlight",
    description: "Turn the phone flashlight/torch on or off.",
    parameters: { type: Type.OBJECT, properties: { on: { type: Type.BOOLEAN, description: "true = on, false = off" } }, required: ["on"] },
  },
  {
    name: "media_control",
    description: "Control music/video playback: play, pause, stop, next, previous. Use for 'gaana band karo', 'next song'.",
    parameters: { type: Type.OBJECT, properties: { action: str("'play', 'pause', 'stop', 'next' or 'previous'") }, required: ["action"] },
  },
  {
    name: "set_volume",
    description: "Change phone volume: up, down, mute, unmute, max, or set to a percent.",
    parameters: {
      type: Type.OBJECT,
      properties: { action: str("'up', 'down', 'mute', 'unmute', 'max' or 'set'"), percent: { type: Type.NUMBER, description: "0-100, only for 'set'" } },
      required: ["action"],
    },
  },
  {
    name: "set_alarm",
    description: "Set a smart alarm at a clock time. Myra warns 2 min before, wakes the user with her voice, and (if wake_check) keeps nudging until the user confirms they're awake. Use for 'alarm laga do', 'subah 6 baje uthana'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        hour: { type: Type.NUMBER, description: "0-23" },
        minute: { type: Type.NUMBER, description: "0-59" },
        label: str("What it's for, e.g. 'gym', 'office'. Optional"),
        repeat: str("'once' (default), 'daily', 'weekdays', or day list like 'mon,wed,fri'"),
        wake_check: { type: Type.BOOLEAN, description: "Keep waking the user until they confirm they're up. Default true for morning alarms." },
      },
      required: ["hour", "minute"],
    },
  },
  {
    name: "snooze_alarm",
    description: "Snooze the currently ringing alarm for a few minutes. Use for '5 minute aur', 'thodi der baad'.",
    parameters: { type: Type.OBJECT, properties: { minutes: { type: Type.NUMBER, description: "Default 5" } } },
  },
  {
    name: "confirm_awake",
    description: "Call when the user shows they are actually awake (says 'main uth gaya', 'I'm up', answers a question). Stops all further wake nudges.",
  },
  {
    name: "cancel_alarm",
    description: "Delete an alarm. Pass which one (time or label); empty cancels all alarms.",
    parameters: { type: Type.OBJECT, properties: { which: str("Time or label to match, e.g. '6 am' or 'gym'. Empty = all") } },
  },
  {
    name: "list_alarms",
    description: "List all the alarms that are set.",
  },
  {
    name: "open_phone_settings",
    description: "Open a phone settings screen: wifi, internet, bluetooth, volume, display, battery, location, or general.",
    parameters: { type: Type.OBJECT, properties: { panel: str("Which settings screen") }, required: ["panel"] },
  },
  {
    name: "phone_action",
    description: "System actions on the phone: back, home, recents, notifications, quick_settings, lock, screenshot, power_menu.",
    parameters: { type: Type.OBJECT, properties: { action: str("One of the listed actions") }, required: ["action"] },
  },
  {
    name: "remember_fact",
    description: "Save a lasting fact about the user to long-term memory (preferences, birthdays, goals, family, name).",
    parameters: { type: Type.OBJECT, properties: { fact: str("The fact in one short sentence, e.g. 'Prashant loves paneer'") }, required: ["fact"] },
  },
  {
    name: "forget_fact",
    description: "Forget memories that contain a keyword.",
    parameters: { type: Type.OBJECT, properties: { keyword: str("Keyword to match, e.g. 'paneer'") }, required: ["keyword"] },
  },
  {
    name: "go_to_sleep",
    description: "End the conversation and go to sleep mode (wake-word listening). Use when the user says bye, so jao, good night, sleep.",
  },
  {
    name: "get_weather",
    description: "Current weather and today's forecast. Without a city, uses the user's location.",
    parameters: { type: Type.OBJECT, properties: { city: str("City name, optional") } },
  },
  {
    name: "get_morning_briefing",
    description: "Morning briefing: date, weather, battery, reminders, notes and relevant memories.",
  },
  {
    name: "set_personality_mode",
    description: "Switch personality mode: sassy, sweet, bestie (best friend), teacher, english (English speaking coach), gamer (games host).",
    parameters: { type: Type.OBJECT, properties: { mode: str("One of: sassy, sweet, bestie, teacher, english, gamer") }, required: ["mode"] },
  },
  {
    name: "camera",
    description: "Turn the camera on/off or flip it, so you can see what the user shows. Use when user says 'dekho', 'yeh kya hai', 'camera kholo'.",
    parameters: { type: Type.OBJECT, properties: { action: str("'on', 'off' or 'flip'") }, required: ["action"] },
  },
  {
    name: "read_notifications",
    description: "Read recent phone notifications (messages, calls). Android app only.",
    parameters: { type: Type.OBJECT, properties: { app: str("Optional app filter like 'whatsapp'"), limit: { type: Type.NUMBER, description: "How many, default 5" } } },
  },
  {
    name: "reply_to_notification",
    description: "Reply to a message notification (e.g. WhatsApp) directly from the notification. Android app only.",
    parameters: {
      type: Type.OBJECT,
      properties: { sender: str("Sender name or chat title as shown in the notification"), message: str("Reply text") },
      required: ["sender", "message"],
    },
  },
  {
    name: "copy_to_clipboard",
    description: "Copy some text to the clipboard.",
    parameters: { type: Type.OBJECT, properties: { text: str("Text to copy") }, required: ["text"] },
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────
const KNOWN_SITES: Record<string, string> = {
  youtube: "https://www.youtube.com",
  instagram: "https://www.instagram.com",
  insta: "https://www.instagram.com",
  facebook: "https://www.facebook.com",
  whatsapp: "https://web.whatsapp.com",
  gmail: "https://mail.google.com",
  mail: "https://mail.google.com",
  maps: "https://maps.google.com",
  "google maps": "https://maps.google.com",
  google: "https://www.google.com",
  twitter: "https://x.com",
  x: "https://x.com",
  spotify: "https://open.spotify.com",
  netflix: "https://www.netflix.com",
  amazon: "https://www.amazon.in",
  flipkart: "https://www.flipkart.com",
  linkedin: "https://www.linkedin.com",
  github: "https://github.com",
  chatgpt: "https://chatgpt.com",
  hotstar: "https://www.hotstar.com",
  jiohotstar: "https://www.hotstar.com",
  "prime video": "https://www.primevideo.com",
  swiggy: "https://www.swiggy.com",
  zomato: "https://www.zomato.com",
  paytm: "https://paytm.com",
  snapchat: "https://www.snapchat.com",
  telegram: "https://web.telegram.org",
  reddit: "https://www.reddit.com",
  wikipedia: "https://www.wikipedia.org",
};

function siteUrl(name: string) {
  const n = name.toLowerCase().trim().replace(/\s+(app|website|site|kholo|open)$/g, "");
  if (KNOWN_SITES[n]) return KNOWN_SITES[n];
  if (/^https?:\/\//.test(n)) return n;
  let site = n.replace(/\s+/g, "");
  if (!site.includes(".")) site += ".com";
  return `https://${site}`;
}

const enc = encodeURIComponent;

/** YouTube Data API se pehla video dhundho, taaki gaana seedha chale */
async function findYouTubeVideo(query: string): Promise<MediaItem | null> {
  const key = process.env.YOUTUBE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&videoEmbeddable=true&q=${enc(query)}&key=${key}`
    );
    if (!r.ok) {
      console.warn("YouTube API error", r.status, "- enable 'YouTube Data API v3' for this key");
      return null;
    }
    const j = await r.json();
    const item = j.items?.[0];
    if (!item?.id?.videoId) return null;
    const title = new DOMParser().parseFromString(item.snippet?.title || query, "text/html").body.textContent || query;
    return { videoId: item.id.videoId, title };
  } catch {
    return null;
  }
}

const deviceLabel = () => (isNativeApp() ? "phone" : isMobileDevice() ? "phone" : "laptop/computer");

const DAY_MAP: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function parseRepeat(s: string): number[] {
  const t = s.toLowerCase().trim();
  if (!t || t === "once" || t === "today" || t === "tomorrow") return [];
  if (t === "daily" || t === "everyday" || t === "roz") return [0, 1, 2, 3, 4, 5, 6];
  if (t === "weekdays") return [1, 2, 3, 4, 5];
  if (t === "weekends") return [0, 6];
  const days = t.split(/[, ]+/).map((d) => DAY_MAP[d.slice(0, 3)]).filter((n) => n !== undefined) as number[];
  return [...new Set(days)];
}

const WEATHER_CODES: Record<number, string> = {
  0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "foggy", 48: "foggy",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "rain showers", 82: "heavy showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
};

function getPosition(timeout = 8000): Promise<GeolocationPosition> {
  return new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, { timeout, maximumAge: 10 * 60000 })
  );
}

/** Open-Meteo: free, bina key ke weather */
async function fetchWeather(city?: string): Promise<string> {
  let lat: number, lon: number, place: string;
  if (city) {
    const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(city)}&count=1&language=en`)).json();
    const hit = g?.results?.[0];
    if (!hit) return `Couldn't find a place called ${city}.`;
    lat = hit.latitude; lon = hit.longitude; place = `${hit.name}${hit.admin1 ? ", " + hit.admin1 : ""}`;
  } else {
    try {
      const pos = await getPosition();
      lat = pos.coords.latitude; lon = pos.coords.longitude; place = "your location";
    } catch {
      return "Location permission not available. Ask the user which city.";
    }
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
  const w = await (await fetch(url)).json();
  const c = w.current, d = w.daily;
  return `Weather at ${place}: ${Math.round(c.temperature_2m)}°C (feels like ${Math.round(c.apparent_temperature)}°C), ${WEATHER_CODES[c.weather_code] || "mixed"}, humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)} km/h. Today: high ${Math.round(d.temperature_2m_max[0])}°C, low ${Math.round(d.temperature_2m_min[0])}°C, rain chance ${d.precipitation_probability_max[0] ?? 0}%.`;
}

/** Link kholo: app me native intent se, website pe UI ko action bhejo */
async function openLink(action: PendingAction, doneMsg: string): Promise<ToolOutcome> {
  if (isNativeApp()) {
    try {
      await DeviceControl.openUrl({ url: action.url });
      return { result: doneMsg };
    } catch (e: any) {
      return { result: `Could not open: ${e?.message || "no app for this link"}` };
    }
  }
  return { result: `${doneMsg} (If the browser blocked it, the user can tap the button on screen.)`, action };
}

type Target = { phone: string; name: string; error?: undefined } | { phone?: undefined; name?: undefined; error: string };

function resolveTarget(contact: string): Target {
  const r = resolveContact(contact);
  switch (r.kind) {
    case "number":
      return { phone: r.phone, name: r.name };
    case "found":
      return { phone: r.contact.phone, name: r.contact.name };
    case "ambiguous":
      return {
        error: `Multiple contacts match "${contact}": ${r.options.map((o) => o.name).join(", ")}. Ask the user which one.`,
      };
    default:
      return {
        error: `No saved contact named "${contact}". Ask the user for the phone number, then use save_contact to save it and try again. The user can also add contacts from the Contacts button on screen.`,
      };
  }
}

// ─── Notes & reminders ──────────────────────────────────────────────────
interface Note { id: string; text: string; at: number }
interface Reminder { id: string; text: string; due: number }

const NOTES_KEY = "assistant_notes";
const REM_KEY = "assistant_reminders";

export function getNotes(): Note[] {
  return loadJSON<Note[]>(NOTES_KEY, []);
}
export function deleteNote(id: string) {
  saveJSON(NOTES_KEY, getNotes().filter((n) => n.id !== id));
}

type ReminderHandler = (text: string) => void;
let reminderHandler: ReminderHandler = () => {};
export function onReminder(fn: ReminderHandler) {
  reminderHandler = fn;
}

function scheduleReminder(r: Reminder) {
  const delay = Math.max(0, r.due - Date.now());
  window.setTimeout(() => {
    saveJSON(REM_KEY, loadJSON<Reminder[]>(REM_KEY, []).filter((x) => x.id !== r.id));
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("⏰ Reminder", { body: r.text });
      }
    } catch {}
    try { navigator.vibrate?.([300, 150, 300]); } catch {}
    reminderHandler(r.text);
  }, delay);
}

/** App load pe purane (pending) reminders dobara schedule karo */
export function restoreReminders() {
  loadJSON<Reminder[]>(REM_KEY, []).forEach(scheduleReminder);
}

// ─── Flashlight ─────────────────────────────────────────────────────────
let torchStream: MediaStream | null = null;

async function setTorch(on: boolean): Promise<string> {
  if (!on) {
    torchStream?.getTracks().forEach((t) => t.stop());
    torchStream = null;
    return "Flashlight turned off.";
  }
  try {
    torchStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const track = torchStream.getVideoTracks()[0];
    const caps: any = track.getCapabilities?.() || {};
    if (!caps.torch) {
      torchStream.getTracks().forEach((t) => t.stop());
      torchStream = null;
      return "This device/browser does not support flashlight control (works only in Chrome on Android).";
    }
    await track.applyConstraints({ advanced: [{ torch: true } as any] });
    return "Flashlight turned on.";
  } catch (e: any) {
    return `Could not turn on flashlight: ${e?.message || "camera permission denied"}.`;
  }
}

// ─── Executor ───────────────────────────────────────────────────────────
export async function runTool(name: string, args: any = {}): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "play_youtube": {
        const video = await findYouTubeVideo(args.query);
        if (video) {
          if (isNativeApp()) {
            return openLink({ url: `https://www.youtube.com/watch?v=${video.videoId}`, label: video.title, icon: "youtube" }, `Playing "${video.title}" in the YouTube app.`);
          }
          return { result: `Now playing "${video.title}" in the in-app player.`, media: video };
        }
        return openLink(
          { url: `https://www.youtube.com/results?search_query=${enc(args.query)}`, label: `YouTube: ${args.query}`, icon: "youtube" },
          "Opened YouTube search results for the song (direct play needs the YouTube Data API enabled)."
        );
      }

      case "play_spotify":
        return openLink({ url: `https://open.spotify.com/search/${enc(args.query)}`, label: `Spotify: ${args.query}`, icon: "music" }, "Spotify search opened.");

      case "open_app_or_website": {
        const raw = String(args.name || "");
        const isDomain = /\.|^https?:/.test(raw);
        if (isNativeApp() && !isDomain) {
          try {
            const r = await DeviceControl.openApp({ name: raw });
            if (r.opened) return { result: `Opened the ${r.label} app.` };
          } catch {}
        }
        const url = siteUrl(raw);
        return openLink({ url, label: `Open ${raw}`, icon: "web" }, `Opened ${url}.`);
      }

      case "google_search": {
        const q = String(args.query || "").trim();
        if (!q) return { result: "No query provided." };

        const results: string[] = [];

        // 1. Wikipedia REST API — sabse reliable free source
        try {
          const wikiSearch = await (await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${enc(q.replace(/ /g, "_"))}`,
            { headers: { "Accept": "application/json" } }
          )).json();
          if (wikiSearch.extract && wikiSearch.type !== "disambiguation") {
            results.push(`Wikipedia: ${wikiSearch.extract.slice(0, 600)}`);
          }
        } catch {}

        // 2. DuckDuckGo Instant Answer
        try {
          const ddg = await (await fetch(
            `https://api.duckduckgo.com/?q=${enc(q)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`
          )).json();
          if (ddg.Answer) results.push(`Answer: ${ddg.Answer}`);
          if (ddg.AbstractText && !results.length) results.push(ddg.AbstractText);
          if (ddg.Definition && !results.length) results.push(`Definition: ${ddg.Definition}`);
          if (ddg.Infobox?.content?.length) {
            const info = ddg.Infobox.content.slice(0, 6)
              .map((i: any) => `${i.label}: ${i.value}`).join(", ");
            if (info) results.push(`Details: ${info}`);
          }
        } catch {}

        // 3. Wikipedia search (agar exact page na mile)
        if (!results.length) {
          try {
            const wikiResults = await (await fetch(
              `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&format=json&origin=*&srlimit=3`
            )).json();
            const hits = wikiResults?.query?.search || [];
            if (hits.length) {
              const snippets = hits.slice(0, 2).map((h: any) =>
                `${h.title}: ${h.snippet.replace(/<[^>]+>/g, "")}`
              ).join(" | ");
              results.push(`Search results: ${snippets}`);
            }
          } catch {}
        }

        if (results.length) {
          return {
            result: `Search results for "${q}": ${results.join(". ")}

IMPORTANT: Read ALL of the above and give a complete, direct answer to the user in Hinglish. Do NOT say "screen pe dekho" or "search ho gaya". Just answer confidently like ChatGPT/Gemini would.`
          };
        }

        // Last fallback — Gemini khud jaanta hai
        return {
          result: `Web search nahi mila for "${q}". Use your own training knowledge to answer this question directly and completely in Hinglish. Don't say you couldn't search — just answer from what you know.`
        };
      }

      case "open_maps": {
        const modes: Record<string, string> = { driving: "driving", walking: "walking", transit: "transit", "two-wheeler": "two-wheeler", bike: "two-wheeler" };
        const mode = modes[(args.mode || "").toLowerCase()];
        const url = `https://www.google.com/maps/dir/?api=1&destination=${enc(args.destination)}${mode ? `&travelmode=${mode}` : ""}`;
        return openLink({ url, label: `Directions: ${args.destination}`, icon: "maps" }, `Directions to ${args.destination} opened.`);
      }

      case "make_call": {
        const t = resolveTarget(args.contact);
        if (t.error !== undefined) return { result: t.error };
        if (isNativeApp()) {
          const r = await DeviceControl.call({ number: t.phone! });
          return { result: r.direct ? `Call to ${t.name} started.` : `Dialer opened for ${t.name} (call permission not given, user must tap call).` };
        }
        const mobile = isMobileDevice();
        return {
          result: mobile
            ? `Dialer ready for ${t.name}; user taps the call button on screen.`
            : `User is on a laptop: the call opens through their linked phone (Phone Link / iPhone), or they can scan the QR code on screen with their phone.`,
          action: { url: `tel:${cleanDialNumber(t.phone!)}`, label: `Call ${t.name}`, icon: "call", phone: cleanDialNumber(t.phone!) },
        };
      }

      case "send_sms": {
        const t = resolveTarget(args.contact);
        if (t.error !== undefined) return { result: t.error };
        if (isNativeApp()) {
          const r = await DeviceControl.sendSms({ number: t.phone!, message: args.message });
          return { result: r.direct ? `SMS sent to ${t.name}.` : `SMS app opened with the message; user must press send (SMS permission not given).` };
        }
        const url = `sms:${cleanDialNumber(t.phone!)}?body=${enc(args.message)}`;
        return {
          result: isMobileDevice()
            ? `SMS to ${t.name} is ready; user taps Send on screen.`
            : `User is on a laptop: SMS opens through their linked phone, or they can scan the QR code with their phone.`,
          action: { url, label: `SMS ${t.name}`, icon: "sms", phone: cleanDialNumber(t.phone!), copyText: args.message },
        };
      }

      case "send_whatsapp": {
        const t = resolveTarget(args.contact);
        if (t.error !== undefined) return { result: t.error };
        const number = toWhatsAppNumber(t.phone!);
        if (isNativeApp()) {
          const r = await DeviceControl.sendWhatsApp({ number, message: args.message, autoSend: true });
          if (!r.installed) return { result: "WhatsApp is not installed on this phone; opened WhatsApp web link instead." };
          return {
            result: r.autoSend
              ? `WhatsApp message to ${t.name} is being sent automatically.`
              : `WhatsApp opened with the message typed; user must press send. (Turn on "Myra phone control" in Accessibility settings for auto-send.)`,
          };
        }
        const url = isMobileDevice()
          ? `https://wa.me/${number}?text=${enc(args.message)}`
          : `https://web.whatsapp.com/send?phone=${number}&text=${enc(args.message)}`;
        return openLink({ url, label: `WhatsApp ${t.name}`, icon: "whatsapp", copyText: args.message }, `WhatsApp chat with ${t.name} opened with the message typed; user presses send.`);
      }

      case "send_email":
        return openLink(
          { url: `mailto:${args.to}?subject=${enc(args.subject || "")}&body=${enc(args.body || "")}`, label: `Email ${args.to}`, icon: "email" },
          "Email draft opened."
        );

      case "save_contact": {
        const c = addContact(args.name, args.phone);
        return { result: `Saved contact ${c.name} (${c.phone}).` };
      }

      case "list_contacts": {
        const list = getContacts();
        return { result: list.length ? `Saved contacts: ${list.map((c) => c.name).join(", ")}` : "No contacts saved yet." };
      }

      case "set_reminder": {
        const minutes = Number(args.minutes);
        if (!isFinite(minutes) || minutes <= 0) return { result: "Invalid time for reminder." };
        if ("Notification" in window && Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
        if (isNativeApp()) {
          await DeviceControl.setTimer({ seconds: Math.round(minutes * 60), message: args.text });
          return { result: `Timer set in the phone's clock app for ${minutes} minutes (works even if Myra is closed).` };
        }
        const r: Reminder = { id: crypto.randomUUID(), text: args.text, due: Date.now() + minutes * 60000 };
        saveJSON(REM_KEY, [...loadJSON<Reminder[]>(REM_KEY, []), r]);
        scheduleReminder(r);
        const at = new Date(r.due).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
        return { result: `Reminder set for ${at}. Note: it only rings while this app is open in the browser.` };
      }

      case "save_note": {
        saveJSON(NOTES_KEY, [...getNotes(), { id: crypto.randomUUID(), text: args.text, at: Date.now() }]);
        return { result: "Note saved." };
      }

      case "read_notes": {
        const notes = getNotes();
        return { result: notes.length ? notes.map((n, i) => `${i + 1}. ${n.text}`).join("\n") : "No notes saved." };
      }

      case "get_device_status": {
        const parts: string[] = [];
        parts.push(`Device: the user is on a ${deviceLabel()} (say "${deviceLabel()}", not "phone", when mentioning the battery)`);
        parts.push(`Now: ${new Date().toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}`);
        parts.push(`Internet: ${navigator.onLine ? "online" : "offline"}`);
        try {
          const b = await (navigator as any).getBattery?.();
          if (b) parts.push(`Battery: ${Math.round(b.level * 100)}%${b.charging ? " (charging)" : ""}`);
          else parts.push("Battery info not available");
        } catch {
          parts.push("Battery info not available");
        }
        return { result: parts.join(". ") };
      }

      case "get_location": {
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000, enableHighAccuracy: true })
        );
        const { latitude: lat, longitude: lon } = pos.coords;
        let place = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=en`);
          const j = await r.json();
          if (j?.display_name) place = j.display_name;
        } catch {}
        return { result: `User is at: ${place}. (Don't open maps unless asked.)` };
      }

      case "toggle_flashlight":
        if (isNativeApp()) {
          await DeviceControl.torch({ on: Boolean(args.on) });
          return { result: `Flashlight ${args.on ? "on" : "off"}.` };
        }
        if (!isMobileDevice()) return { result: "This is a laptop/computer, it has no flashlight." };
        return { result: await setTorch(Boolean(args.on)) };

      case "media_control": {
        const a = String(args.action || "pause").toLowerCase();
        if (isNativeApp()) {
          const map: Record<string, string> = { stop: "pause", pause: "pause", play: "play", next: "next", previous: "previous" };
          await DeviceControl.media({ action: map[a] || "play_pause" });
          return { result: `Media ${a} done.` };
        }
        if (a === "next" || a === "previous") return { result: "In the browser I can't skip tracks; ask for a new song to play instead." };
        return { result: `Media ${a} done.`, mediaCommand: (a === "stop" ? "stop" : a === "play" ? "play" : "pause") };
      }

      case "set_volume": {
        const a = String(args.action || "up").toLowerCase();
        if (isNativeApp()) {
          const r = await DeviceControl.volume({ action: a, percent: args.percent });
          return { result: `Volume is now ${r.percent}%.` };
        }
        if (a === "mute" || a === "unmute") return { result: `Player ${a}d.`, mediaCommand: a as MediaCommand };
        return { result: "In the browser I can't change system volume; the user can use their volume keys." };
      }

      case "set_alarm": {
        const hour = Math.round(Number(args.hour)), minute = Math.round(Number(args.minute) || 0);
        if (!(hour >= 0 && hour < 24 && minute >= 0 && minute < 60)) return { result: "Invalid alarm time." };
        const label = String(args.label || "Alarm");
        const repeat = parseRepeat(String(args.repeat || "once"));
        const wakeCheck = args.wake_check !== false && (hour < 11); // subah wale alarm peeche padte hain
        const alarm = addAlarm({ hour, minute, label, repeat, wakeCheck: args.wake_check === true || wakeCheck, preKey: undefined, ringKey: undefined });
        if (isNativeApp()) {
          try { await DeviceControl.scheduleWake({ id: alarm.id, hour, minute, label }); } catch {}
        }
        return {
          result: `Smart alarm set for ${describeAlarm(alarm)}. I'll warn 2 minutes before and wake them up${alarm.wakeCheck ? ", and keep nudging until they're actually awake" : ""}. Tell the user in one warm line.${isNativeApp() ? "" : " (Works while this app is open — tell them to keep it open by the bed.)"}`,
        };
      }

      case "snooze_alarm": {
        if (!alarmEngine.ringing) return { result: "No alarm is ringing right now." };
        const mins = Math.max(1, Math.round(Number(args.minutes) || 5));
        alarmEngine.snooze(mins);
        return { result: `Snoozed for ${mins} minutes. Say one short teasing line about not oversleeping.` };
      }

      case "confirm_awake":
        alarmEngine.confirmAwake();
        return { result: "Great, user is awake. Praise them warmly in one line and maybe give a tiny motivational push for the day." };

      case "cancel_alarm": {
        const which = String(args.which || "").toLowerCase().trim();
        const all = getAlarms();
        if (!all.length) return { result: "No alarms are set." };
        if (!which) { all.forEach((a) => removeAlarm(a.id)); return { result: `Cancelled all ${all.length} alarms.` }; }
        const hit = all.filter((a) => describeAlarm(a).toLowerCase().includes(which) || fmtTime(a.hour, a.minute).toLowerCase().includes(which) || a.label.toLowerCase().includes(which));
        if (!hit.length) return { result: `No alarm matched "${args.which}".` };
        hit.forEach((a) => { removeAlarm(a.id); if (isNativeApp()) DeviceControl.cancelWake({ id: a.id }).catch(() => {}); });
        return { result: `Cancelled: ${hit.map(describeAlarm).join("; ")}.` };
      }

      case "list_alarms": {
        const all = getAlarms();
        return { result: all.length ? `Alarms: ${all.map((a) => `${describeAlarm(a)}${a.enabled ? "" : " (off)"}`).join("; ")}.` : "No alarms are set." };
      }

      case "open_phone_settings":
        if (!isNativeApp()) return { result: "Opening phone settings only works in the Android app." };
        await DeviceControl.openSettings({ panel: String(args.panel || "general").toLowerCase() });
        return { result: `${args.panel} settings opened.` };

      case "phone_action":
        if (!isNativeApp()) return { result: "Phone actions only work in the Android app." };
        try {
          await DeviceControl.phoneAction({ action: String(args.action).toLowerCase() });
          return { result: `${args.action} done.` };
        } catch (e: any) {
          if (String(e?.message).includes("ACCESSIBILITY_OFF"))
            return { result: "Phone control is off. User must turn on 'Myra phone control' in Accessibility settings (Setup screen in the app)." };
          return { result: `Failed: ${e?.message}` };
        }

      case "remember_fact": {
        const fact = String(args.fact || "");
        if (/password|otp|pin\b|cvv|card number|bank/i.test(fact)) return { result: "Refused: sensitive info is never stored." };
        remember(fact);
        return { result: "Remembered." };
      }

      case "forget_fact": {
        const n = forget(String(args.keyword || ""));
        return { result: n ? `Forgot ${n} memory item(s).` : "Nothing matched to forget." };
      }

      case "go_to_sleep":
        return { result: "Going to sleep now. Say bye in 3-4 words max.", sleep: true };

      case "get_weather":
        return { result: await fetchWeather(args.city) };

      case "get_morning_briefing": {
        const parts: string[] = [`Today is ${new Date().toLocaleDateString("en-IN", { dateStyle: "full" })}.`];
        try { parts.push(await fetchWeather()); } catch { parts.push("Weather unavailable."); }
        try {
          const b = await (navigator as any).getBattery?.();
          if (b) parts.push(`The user's ${deviceLabel()} battery is ${Math.round(b.level * 100)}%${b.charging ? " (charging)" : ""} (call it a ${deviceLabel()}, not a phone).`);
        } catch {}
        const rems = loadJSON<Reminder[]>(REM_KEY, []).filter((r) => r.due > Date.now());
        if (rems.length) parts.push(`Upcoming reminders: ${rems.map((r) => `${r.text} at ${new Date(r.due).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`).join("; ")}.`);
        const notes = getNotes();
        if (notes.length) parts.push(`${notes.length} saved notes, latest: "${notes[notes.length - 1].text}".`);
        const mem = getMemories().slice(-6).map((m) => m.text);
        if (mem.length) parts.push(`Things you know about the user (mention only if relevant today): ${mem.join("; ")}.`);
        return { result: parts.join(" ") };
      }

      case "set_personality_mode": {
        const m = String(args.mode || "").toLowerCase() as PersonalityMode;
        if (!MODES[m]) return { result: "Unknown mode. Options: sassy, sweet, bestie, teacher, english, gamer." };
        updateSettings({ mode: m });
        return { result: `Switched to ${MODES[m].label} mode. Say one short line; the session will restart in the new personality.`, restartSession: true };
      }

      case "camera": {
        const a = String(args.action || "on").toLowerCase();
        const action = a === "off" ? "off" : a === "flip" ? "flip" : "on";
        return { result: action === "off" ? "Camera turned off." : "Camera is on; you'll start seeing frames in a moment.", camera: action };
      }

      case "read_notifications": {
        if (!isNativeApp()) return { result: "Reading notifications only works in the Android app." };
        try {
          const r = await DeviceControl.getNotifications({ app: args.app, limit: Math.min(10, Number(args.limit) || 5) });
          if (!r.items.length) return { result: "No recent notifications." };
          return { result: r.items.map((n) => `${n.app}: ${n.title} — ${n.text}`).join("\n") };
        } catch (e: any) {
          if (String(e?.message).includes("ACCESS_OFF"))
            return { result: "Notification access is off. User must enable it in the Setup screen." };
          return { result: `Failed: ${e?.message}` };
        }
      }

      case "reply_to_notification": {
        if (!isNativeApp()) return { result: "Replying to notifications only works in the Android app." };
        try {
          const r = await DeviceControl.replyNotification({ match: args.sender, message: args.message });
          return { result: r.sent ? `Replied to ${r.title}.` : `No repliable notification from "${args.sender}". Offer to send via send_whatsapp instead.` };
        } catch (e: any) {
          if (String(e?.message).includes("ACCESS_OFF"))
            return { result: "Notification access is off. User must enable it in the Setup screen." };
          return { result: `Failed: ${e?.message}` };
        }
      }

      case "copy_to_clipboard":
        await navigator.clipboard.writeText(args.text);
        return { result: "Copied to clipboard." };

      default:
        return { result: `Unknown tool ${name}.` };
    }
  } catch (e: any) {
    console.error("Tool error", name, e);
    return { result: `Failed: ${e?.message || "unknown error"}` };
  }
}

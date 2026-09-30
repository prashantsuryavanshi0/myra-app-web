// ─── Yahan se apni assistant customize karo ─────────────────────────────
export const ASSISTANT_NAME = "Myra";       // assistant ka naam
export const CREATOR_NAME = "Prashant";     // tumhara naam (jisko wo roast karegi)
export const DEFAULT_COUNTRY_CODE = "91";   // 10-digit numbers ke aage lagega (WhatsApp ke liye)

// Gemini models (free tier wale)
export const LIVE_MODEL = "gemini-3.8-live";
export const CHAT_MODEL = "gemini-3.5-flash-lite";
export const TTS_MODEL = "gemini-3.8-flash-lite-tts";

// Live mode me Google Search (news, scores). Free quota jaldi khatam karta hai, isliye off.
// Weather ke liye alag free API use hoti hai, uske liye yeh zaroori nahi.
export const ENABLE_GOOGLE_SEARCH = false;

// Wake words: inme se koi bhi suna toh Myra jaag jayegi (chhote/aam shabd na daalein)
export const WAKE_WORDS = ["hello myra", "hey myra", "hi myra", "ok myra", "hello mira", "hello meera", "hello maira", "hello mayra", "myra", "maira", "meera", "mira", "mayra", "maura", "meira"];
// Sleep words: session band karke wapas sleep mode
export const SLEEP_WORDS = ["so jao", "sleep", "bye", "good night", "chup ho jao", "band ho jao", "tata"];

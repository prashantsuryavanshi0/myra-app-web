# Myra – AI Voice Assistant (Website + Android App)

Hinglish bolne wali AI assistant jo device control kar sakti hai. Ek hi code se website aur Android app dono banti hain.

## ✨ Features

**Awaaz se control**
- "Hello Myra" bolke jagao (button dabana zaroori nahi)
- Chup raho toh khud so jaati hai (free quota bachti hai)
- "bye Myra" / "so jao" bolke sula do
- Internet aate hi khud sun-ne ke liye taiyaar ho jaati hai

**Personality & awaaz**
- 6 modes: Sassy 💅, Sweet 🌸, Best friend 🤙, Teacher 📚, English coach 🗣️, Game master 🎮
- Alag-alag female voices choose karo
- Yaaddasht: naam, pasand, birthday, goals yaad rakhti hai

**Dekhna**
- Camera dikha ke "yeh kya hai?" pucho
- Laptop pe screen share karke "yeh error kya hai?" pucho

**Kaam (device)**
- YouTube/Spotify gaana, koi bhi app/website kholna
- Naam se call, SMS, WhatsApp; email; Maps directions
- Alarm, timer, reminder, notes, weather, battery, location, torch, volume
- Morning briefing: "good morning" pe mausam + reminders + motivation

**Sirf Android app me**
- Seedha call/SMS, WhatsApp auto-send
- Phone ke saare contacts
- Notifications padhna + WhatsApp reply karna
- "kaun call kar raha hai" announce karna
- Back / Home / Lock / Screenshot, settings kholna

## Run locally (Windows/Mac)
1. `npm install`
2. `.env.local` banao: `GEMINI_API_KEY=your_key` (free: aistudio.google.com/apikey)
3. `npm run dev` → http://localhost:3000
4. Ek baar "Tap to turn on" dabao, phir "Hello Myra" bolo

Gaana seedha chalane ke liye Google Cloud Console me "YouTube Data API v3" enable karo (same key).

## Website deploy
Vercel/Netlify pe repo import karo → env `GEMINI_API_KEY` daalo → deploy.

## Android APK (bina Android Studio ke)
1. GitHub repo → Settings → Secrets → Actions → `GEMINI_API_KEY`
2. Code push karo → Actions tab → "Build Android APK" (~6 min)
3. Run → Artifacts → `aayat-apk` download → APK install
4. App me ⚙️ Setup: permissions, contacts, accessibility, notification access on karo

## Customize
- Naam, models, wake words → `src/config.ts`
- Personality modes/voices → `src/services/settings.ts`
- Tools/features → `src/services/tools.ts`
- Native Android → `android/app/src/main/java/com/aayat/assistant/`

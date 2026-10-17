import { GoogleGenAI } from "@google/genai";
import { toolDeclarations, runTool, ToolOutcome } from "./tools";
import { buildSystemInstruction } from "./persona";
import { CHAT_MODEL, TTS_MODEL } from "../config";
import { getSettings } from "./settings";

export interface AssistantReply {
  text: string;
  outcomes: ToolOutcome[];
}

let chatSession: any = null;

export function resetMyraSession() {
  chatSession = null;
}

export async function getMyraResponse(prompt: string, history: { sender: "user" | "aayat", text: string }[] = []): Promise<AssistantReply> {
  const outcomes: ToolOutcome[] = [];
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    if (!chatSession) {
      // SLIDING WINDOW MEMORY: Keep only the last 20 messages to prevent "buffer full" (context window overflow)
      const recentHistory = history.slice(-20);
      
      let formattedHistory: any[] = [];
      let currentRole = "";
      let currentText = "";

      for (const msg of recentHistory) {
        const role = msg.sender === "user" ? "user" : "model";
        if (role === currentRole) {
          currentText += "\n" + msg.text;
        } else {
          if (currentRole !== "") {
            formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
          }
          currentRole = role;
          currentText = msg.text;
        }
      }
      if (currentRole !== "") {
        formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
      }

      if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
        formattedHistory.shift();
      }

      chatSession = ai.chats.create({
        model: CHAT_MODEL,
        config: {
          systemInstruction: buildSystemInstruction(),
          tools: [{ functionDeclarations: toolDeclarations }],
        },
        history: formattedHistory,
      });
    }

    let response = await chatSession.sendMessage({ message: prompt });

    // Tool-calling loop: model action maange toh chalao aur result wapas bhejo
    for (let i = 0; i < 5 && response.functionCalls?.length; i++) {
      const parts = [];
      for (const call of response.functionCalls) {
        const outcome = await runTool(call.name, call.args);
        outcomes.push(outcome);
        parts.push({ functionResponse: { name: call.name, id: call.id, response: { result: outcome.result } } });
      }
      response = await chatSession.sendMessage({ message: parts });
    }

    return { text: response.text || "Ho gaya. Ab khush?", outcomes };
  } catch (error: any) {
    chatSession = null;
    console.error("[Gemini chat] failed:", error);
    const msg = String(error?.message || error || "");
    if (/api.?key|invalid.?key|401|403|UNAUTHENTICATED|PERMISSION_DENIED/i.test(msg)) {
      return { text: "🔑 API key nahi hai ya galat hai. Netlify me GEMINI_API_KEY set karo.", outcomes };
    }
    if (/quota|429|RESOURCE_EXHAUSTED/i.test(msg)) {
      return { text: "⚠️ Free quota khatam ho gaya. Thodi der baad try karo.", outcomes };
    }
    return { text: `Kuch gadbad ho gayi: ${msg || "unknown error"}. Dobara try karo.`, outcomes };
  }
}

export async function getMyraAudio(text: string): Promise<string | null> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: getSettings().voice },
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.error("[Gemini TTS] failed:", error);
    return null;
  }
}


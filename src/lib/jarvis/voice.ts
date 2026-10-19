import "server-only";

import { getAIProvider } from "@/lib/ai";
import { refreshCredentialCache, runWithOpenAICredential } from "@/lib/ai/credentials";
import { getEnv } from "@/lib/env";
import { jarvisBrainTurn } from "@/lib/jarvis/brain";
import { fallbackSpokenReply } from "@/lib/jarvis/voice-text";

export type JarvisVoiceTurn = {
  intent: string;
  summary: string;
  spoken: string;
  heard: string;
  threadId: string;
  taskIds: string[];
  leadIds: string[];
  audioBase64: string | null;
  audioMime: string | null;
  voiceEngine: "openai" | "none";
};

export { fallbackSpokenReply } from "@/lib/jarvis/voice-text";

export async function openaiVoiceConfigured() {
  // Speech-to-text / text-to-speech use OpenAI audio endpoints. OpenRouter has no audio API,
  // so voice falls back to the browser's built-in speech when AI_PROVIDER=openrouter.
  if (getEnv().aiProvider !== "openai") return false;
  await refreshCredentialCache();
  return getAIProvider().configured;
}

async function transcribeAudio(buffer: Buffer, filename: string, mime: string) {
  const env = getEnv();
  const { result } = await runWithOpenAICredential({
    operation: "transcribe",
    model: env.openaiSttModel,
    execute: async (client) => {
      const file = new File([new Uint8Array(buffer)], filename, { type: mime || "audio/webm" });
      return client.audio.transcriptions.create({
        file,
        model: env.openaiSttModel,
        language: "en",
      });
    },
  });
  return (result.text ?? "").trim();
}

async function synthesizeSpeech(spoken: string) {
  const env = getEnv();
  const models = Array.from(new Set([env.openaiTtsModel, "gpt-4o-mini-tts", "tts-1-hd", "tts-1"]));
  const voices = Array.from(new Set([env.openaiTtsVoice, "coral", "alloy"]));
  let lastError: unknown = null;
  for (const model of models) {
    for (const voice of voices) {
      try {
        const { result } = await runWithOpenAICredential({
          operation: "speech",
          model,
          execute: async (client) => {
            const payload: Record<string, unknown> = {
              model,
              voice,
              input: spoken.slice(0, 900),
              response_format: "mp3",
            };
            if (model.includes("gpt-4o")) {
              payload.instructions =
                "Warm, clear colleague. Conversational like ChatGPT voice. Not robotic, not theatrical. Steady pace.";
            }
            return client.audio.speech.create(payload as never);
          },
        });
        const bytes = Buffer.from(await result.arrayBuffer());
        return { audioBase64: bytes.toString("base64"), audioMime: "audio/mpeg" as const };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenAI speech failed.");
}

export async function runJarvisVoiceTurn(input: {
  text?: string;
  audio?: { buffer: Buffer; filename: string; mime: string };
  speak: boolean;
  threadId?: string | null;
}): Promise<JarvisVoiceTurn> {
  let heard = (input.text ?? "").trim();
  const configured = await openaiVoiceConfigured();

  if (!heard && input.audio) {
    if (!configured) throw new Error("OpenAI is not configured for voice. Set OPENAI_API_KEY.");
    heard = await transcribeAudio(input.audio.buffer, input.audio.filename, input.audio.mime);
  }
  if (!heard) {
    return {
      intent: "UNKNOWN",
      summary: "I did not catch that.",
      taskIds: [],
      leadIds: [],
      threadId: input.threadId ?? "",
      heard: "",
      spoken: "I did not catch that. Try again, a little closer to the mic.",
      audioBase64: null,
      audioMime: null,
      voiceEngine: "none",
    };
  }

  const result = await jarvisBrainTurn({ message: heard, threadId: input.threadId });
  const spoken = fallbackSpokenReply(result.spoken);
  let audioBase64: string | null = null;
  let audioMime: string | null = null;
  let voiceEngine: "openai" | "none" = "none";

  if (input.speak && configured) {
    try {
      const audio = await synthesizeSpeech(spoken);
      audioBase64 = audio.audioBase64;
      audioMime = audio.audioMime;
      voiceEngine = "openai";
    } catch {
      voiceEngine = "none";
    }
  }

  return {
    intent: result.intent,
    summary: spoken,
    heard: result.heard,
    spoken,
    threadId: result.threadId,
    taskIds: [],
    leadIds: result.lastLeadId ? [result.lastLeadId] : [],
    audioBase64,
    audioMime,
    voiceEngine,
  };
}

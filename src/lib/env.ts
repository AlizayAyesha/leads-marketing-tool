import "server-only";

import { resolveAIConfig } from "@/lib/ai/config";

import { LINKEDIN_SEND_UNAVAILABLE_REASON } from "@/lib/linkedin/send/types";
import { getChromeSession } from "@/lib/tools/chrome";

function read(name: string) {
  return process.env[name]?.trim() || "";
}

export function getEnv() {
  return {
    appUrl: read("APP_URL") || "http://localhost:3000",
    databaseUrl: read("DATABASE_URL"),
    directUrl: read("DIRECT_URL"),
    aiProvider: resolveAIConfig().provider,
    aiProviderLabel: resolveAIConfig().label,
    /** Key for the active AI provider (OpenRouter or OpenAI). Name kept for compatibility. */
    openaiKey: resolveAIConfig().apiKey,
    openaiModel: resolveAIConfig().model,
    /** Voice (STT/TTS) uses OpenAI audio endpoints and needs a real OPENAI_API_KEY. */
    openaiAudioKey: read("OPENAI_API_KEY"),
    openaiSttModel: read("OPENAI_STT_MODEL") || "whisper-1",
    openaiTtsModel: read("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts",
    openaiTtsVoice: read("OPENAI_TTS_VOICE") || "coral",
    googleClientId: read("GOOGLE_CLIENT_ID"),
    googleClientSecret: read("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri:
      read("GOOGLE_REDIRECT_URI") ||
      `${read("APP_URL") || "http://localhost:3000"}/api/google/callback`,
    supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceRole: read("SUPABASE_SERVICE_ROLE_KEY"),
    apifyToken: read("APIFY_TOKEN") || read("APIFY_API_TOKEN"),
    pdlApiKey: read("PDL_API_KEY"),
    linkedinResearchProvider: read("LINKEDIN_RESEARCH_PROVIDER").toLowerCase(),
    linkedinConnectionStatusProvider: read("LINKEDIN_CONNECTION_STATUS_PROVIDER").toLowerCase(),
    instagramResearchProvider: read("INSTAGRAM_RESEARCH_PROVIDER").toLowerCase(),
    linkedinSchedulerUrl: read("LINKEDIN_SCHEDULER_URL"),
    devAuthEnabled: read("DEV_AUTH_ENABLED") === "true",
  };
}

export function integrationStatus() {
  const env = getEnv();
  const chrome = getChromeSession();
  return {
    database: {
      configured: Boolean(env.databaseUrl),
      label: "PostgreSQL",
      detail: env.databaseUrl
        ? "DATABASE_URL is set"
        : "Set DATABASE_URL before running Jarvis",
    },
    openai: {
      configured: Boolean(env.openaiKey),
      label: `AI (${env.aiProviderLabel})`,
      detail: env.openaiKey
        ? `${env.aiProviderLabel} · model ${env.openaiModel}`
        : "Unset — agents use labeled heuristic mode",
    },
    google: {
      configured: Boolean(env.googleClientId && env.googleClientSecret),
      label: "Google Sheets",
      detail:
        env.googleClientId && env.googleClientSecret
          ? "OAuth client configured"
          : "Unset — use CSV / manual intake, or add GOOGLE_CLIENT_ID and SECRET",
    },
    supabase: {
      configured: Boolean(env.supabaseUrl && env.supabaseAnonKey),
      label: "Supabase Auth",
      detail:
        env.supabaseUrl && env.supabaseAnonKey
          ? "Supabase Auth ready"
          : env.devAuthEnabled
            ? "Local operator mode (DEV_AUTH_ENABLED)"
            : "Supabase Auth is not configured",
    },
    apify: {
      configured: Boolean(env.apifyToken),
      label: "Apify",
      detail: env.apifyToken
        ? "Token present in environment"
        : "Unset — connect from Integrations or set APIFY_TOKEN",
    },
    pdl: {
      configured: Boolean(env.pdlApiKey),
      label: "People Data Labs",
      detail: env.pdlApiKey
        ? "PDL_API_KEY is set — licensed person enrichment/search"
        : "Unset — add a key under Integrations → API Keys or set PDL_API_KEY",
    },
    linkedinResearch: {
      configured: Boolean(
        env.pdlApiKey ||
          (env.linkedinResearchProvider &&
            env.linkedinResearchProvider !== "none" &&
            env.linkedinResearchProvider !== "unavailable"),
      ),
      label: "LinkedIn research",
      detail: env.linkedinResearchProvider === "agent-reach" || env.linkedinResearchProvider === "agentreach"
        ? "Agent-Reach public LinkedIn read is selected. A login wall is not evidence. Sending is not enabled."
        : env.pdlApiKey
          ? "People Data Labs will be used for authorized LinkedIn person research (optional, not required)"
          : env.linkedinResearchProvider && env.linkedinResearchProvider !== "none"
            ? `Provider ${env.linkedinResearchProvider}`
            : "Unset — LinkedIn research returns LINKEDIN_RESEARCH_UNAVAILABLE. PDL is not required."
    },
    instagramResearch: {
      configured: Boolean(env.instagramResearchProvider && env.instagramResearchProvider !== "none"),
      label: "Instagram research",
      detail:
        env.instagramResearchProvider && env.instagramResearchProvider !== "none"
          ? `Provider ${env.instagramResearchProvider}`
          : "Unset — Instagram research returns INSTAGRAM_RESEARCH_UNAVAILABLE",
    },
    linkedinSend: {
      configured: chrome.status === "CONNECTED",
      label: "LinkedIn send",
      detail:
        chrome.status === "CONNECTED"
          ? "Jarvis Chrome is connected. LinkedIn account actions use this signed-in session."
          : LINKEDIN_SEND_UNAVAILABLE_REASON,
    },
    linkedinConnectionStatus: {
      configured: chrome.status === "CONNECTED",
      label: "LinkedIn connection status",
      detail:
        chrome.status === "CONNECTED"
          ? "Connection acceptance is read from the signed-in LinkedIn session. REQUESTED is not CONNECTED."
          : "Connect Jarvis Chrome with a signed-in LinkedIn session. UNKNOWN is not CONNECTED.",
    },
  };
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Sparkles, Volume2, VolumeX } from "lucide-react";

import { isWorkforceFunnel, type WorkforceFunnel } from "@/lib/workforce/types";
import { JobFunnelCard } from "@/components/jarvis/job-funnel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type VoiceTurnResponse = {
  intent?: string;
  summary?: string;
  spoken?: string;
  heard?: string;
  threadId?: string;
  data?: unknown;
  audioBase64?: string | null;
  audioMime?: string | null;
  voiceEngine?: "openai" | "none";
  error?: string;
};

export type JarvisChatMessage = {
  id: string;
  role: string;
  content: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getSpeechRecognition(): BrowserSpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const Speech =
    (window as Window & { SpeechRecognition?: new () => BrowserSpeechRecognition }).SpeechRecognition ||
    (window as Window & { webkitSpeechRecognition?: new () => BrowserSpeechRecognition }).webkitSpeechRecognition;
  return Speech ? new Speech() : null;
}

function speakLocal(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const clean = text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean.slice(0, 900));
  utterance.rate = 1.02;
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((voice) => /en[-_]US/i.test(voice.lang) && /Google|Samantha|Natural/i.test(voice.name)) ||
    voices.find((voice) => /en[-_]US/i.test(voice.lang)) ||
    voices.find((voice) => voice.lang.startsWith("en"));
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

function playOpenAIAudio(base64: string, mime: string, audioRef: { current: HTMLAudioElement | null }) {
  window.speechSynthesis?.cancel();
  audioRef.current?.pause();
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || "audio/mpeg" }));
  const audio = new Audio(url);
  audioRef.current = audio;
  audio.onended = () => URL.revokeObjectURL(url);
  void audio.play().catch(() => {
    URL.revokeObjectURL(url);
  });
}

function recorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

export function JarvisBar({
  compact = false,
  threadId = null,
  messages = [],
}: {
  compact?: boolean;
  threadId?: string | null;
  messages?: JarvisChatMessage[];
}) {
  const router = useRouter();
  const [command, setCommand] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [job, setJob] = useState<WorkforceFunnel | null>(null);
  const [pending, start] = useTransition();
  const [listening, setListening] = useState(false);
  const [voiceReply, setVoiceReply] = useState(true);
  const [openaiVoice, setOpenaiVoice] = useState(false);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceReplyRef = useRef(voiceReply);
  const transcriptRef = useRef("");
  const pendingRef = useRef(pending);
  const openaiVoiceRef = useRef(false);
  const [thread, setThread] = useState(threadId);
  const threadRef = useRef(threadId);

  useEffect(() => {
    voiceReplyRef.current = voiceReply;
  }, [voiceReply]);

  pendingRef.current = pending;
  openaiVoiceRef.current = openaiVoice;
  threadRef.current = thread;

  useEffect(() => {
    setThread(threadId);
    threadRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    void fetch("/api/jarvis/voice/status")
      .then((res) => res.json())
      .then((body: { openai?: boolean }) => setOpenaiVoice(Boolean(body.openai)))
      .catch(() => setOpenaiVoice(false));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const refresh = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => {
      recognitionRef.current?.abort();
      recorderRef.current?.state === "recording" && recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioRef.current?.pause();
      window.speechSynthesis.removeEventListener("voiceschanged", refresh);
      window.speechSynthesis.cancel();
    };
  }, []);

  async function submitVoiceTurn(form: FormData) {
    if (threadRef.current) form.set("threadId", threadRef.current);
    const response = await fetch("/api/jarvis/voice/turn", { method: "POST", body: form });
    const body = (await response.json()) as VoiceTurnResponse;
    if (!response.ok) throw new Error(body.error || "Voice turn failed.");
    return body;
  }

  function applyTurn(body: VoiceTurnResponse) {
    if (body.heard) setCommand(body.heard);
    if (body.threadId) {
      setThread(body.threadId);
      threadRef.current = body.threadId;
    }
    const spoken = body.spoken || body.summary || "";
    setSummary(spoken);
    setJob(isWorkforceFunnel(body.data) ? body.data : null);
    if (voiceReplyRef.current) {
      if (body.audioBase64) {
        try {
          playOpenAIAudio(body.audioBase64, body.audioMime || "audio/mpeg", audioRef);
        } catch {
          speakLocal(spoken);
        }
      } else speakLocal(spoken);
    }
    router.refresh();
  }

  function runCommand(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setCommand(trimmed);
    start(async () => {
      try {
        const form = new FormData();
        form.set("text", trimmed);
        form.set("speak", voiceReplyRef.current ? "true" : "false");
        applyTurn(await submitVoiceTurn(form));
      } catch (error) {
        setVoiceHint(error instanceof Error ? error.message : "Jarvis turn failed.");
      }
    });
  }

  async function finishRecording() {
    const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (blob.size < 800) {
      setVoiceHint("I barely heard anything. Click Talk and speak, then Stop.");
      return;
    }
    start(async () => {
      try {
        const form = new FormData();
        form.set("audio", blob, "speech.webm");
        form.set("speak", voiceReplyRef.current ? "true" : "false");
        applyTurn(await submitVoiceTurn(form));
        setVoiceHint("OpenAI voice. Ask anything about execution — I will answer out loud.");
      } catch (error) {
        setVoiceHint(error instanceof Error ? error.message : "Could not run voice turn.");
      }
    });
  }

  async function startOpenAIRecording() {
    const mime = recorderMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser cannot record audio.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      void finishRecording();
    };
    recorderRef.current = recorder;
    recorder.start();
    setVoiceHint("Listening with Whisper… speak, then click Stop. I will answer in ChatGPT-style voice.");
    setListening(true);
  }

  function startBrowserListen() {
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setVoiceHint("Voice needs Chrome or Edge, plus OPENAI_API_KEY for ChatGPT-style speech.");
      return;
    }
    window.speechSynthesis?.cancel();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const pieces: string[] = [];
      for (let i = 0; i < event.results.length; i += 1) {
        pieces.push(event.results[i][0]?.transcript ?? "");
      }
      const heard = pieces.join(" ").trim();
      transcriptRef.current = heard;
      if (heard) setCommand(heard);
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === "not-allowed") setVoiceHint("Mic blocked. Allow microphone, then try Talk.");
      else if (event.error !== "aborted") setVoiceHint(`Could not hear that (${event.error}).`);
    };
    recognition.onend = () => {
      setListening(false);
      const heard = transcriptRef.current.trim();
      if (heard && !pendingRef.current) runCommand(heard);
    };
    recognitionRef.current = recognition;
    transcriptRef.current = "";
    setVoiceHint("Listening (browser)… OpenAI voice is off until OPENAI_API_KEY is set.");
    setListening(true);
    recognition.start();
  }

  function toggleListen() {
    if (listening) {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    if (openaiVoice) {
      void startOpenAIRecording().catch((error) => {
        setVoiceHint(error instanceof Error ? error.message : "Mic failed.");
        startBrowserListen();
      });
      return;
    }
    startBrowserListen();
  }

  const visible = messages.filter((row) => row.role === "USER" || row.role === "ASSISTANT");

  return (
    <div className={compact ? "" : "glass mb-8 rounded-2xl p-4"}>
      {visible.length ? (
        <div className="mb-4 max-h-80 space-y-3 overflow-y-auto">
          {visible.map((row) => (
            <div key={row.id} className="text-sm">
              <p className="text-[10px] uppercase tracking-wider text-muted">{row.role === "USER" ? "You" : "Jarvis"}</p>
              <p className="mt-1 whitespace-pre-wrap text-emerald-50/90">{row.content}</p>
            </div>
          ))}
        </div>
      ) : null}
      <form
        className="flex flex-col gap-3 md:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          runCommand(command);
        }}
      >
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-emerald-400" />
          <Input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="Message Jarvis"
            className="pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={listening ? "danger" : "outline"} onClick={toggleListen} disabled={pending}>
            {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            {listening ? "Stop" : "Talk"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const next = !voiceReply;
              setVoiceReply(next);
              if (!next) {
                window.speechSynthesis?.cancel();
                audioRef.current?.pause();
              }
            }}
            aria-pressed={voiceReply}
          >
            {voiceReply ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            {voiceReply ? "Voice on" : "Voice off"}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Working…" : "Run"}
          </Button>
        </div>
      </form>
      {voiceHint ? <p className="mt-2 text-xs text-muted">{voiceHint}</p> : null}
      {summary ? <p className="mt-3 whitespace-pre-wrap text-sm text-emerald-100/80">{summary}</p> : null}
      {job ? (
        <div className="mt-4">
          <JobFunnelCard job={job} />
        </div>
      ) : null}
    </div>
  );
}

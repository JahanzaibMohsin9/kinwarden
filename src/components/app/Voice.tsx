"use client";

import { Loader2, Mic, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/domain/types";
import { cn } from "@/lib/format";

const MAX_SECONDS = 90;
const SPEECH_LANG: Record<Lang, string> = { en: "en-GB", zh: "zh-CN", ur: "ur-PK" };

function pickMime() {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
}

/**
 * Record a voice note, have it transcribed on the server (OpenAI speech-to-text), and hand back the text.
 * Tap to start, tap again to send.
 */
export function VoiceButton({ lang, onText, labels }: { lang: Lang; onText: (text: string) => Promise<void> | void; labels: { record: string; stop: string; working: string; note: string } }) {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!pickMime();

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stop();
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("sending");
        try {
          const type = r.mimeType || mime || "audio/webm";
          const fd = new FormData();
          fd.set("audio", new Blob(chunks.current, { type }), `voice.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`);
          fd.set("lang", lang);
          const res = await fetch("/api/voice", { method: "POST", body: fd });
          const j = (await res.json()) as { text?: string; error?: string };
          if (!res.ok || !j.text) throw new Error(j.error ?? "Couldn't transcribe the recording.");
          await onText(j.text);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setState("idle");
        }
      };
      rec.current = r;
      r.start();
      setSecs(0);
      setState("recording");
      timer.current = setInterval(() => {
        setSecs((s) => {
          if (s + 1 >= MAX_SECONDS) stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setError("The microphone isn't available. Allow it in your browser, or type your message.");
    }
  };

  if (!supported) return null;
  return (
    <div className="relative">
      {state === "recording" ? (
        <button type="button" onClick={stop} aria-label={labels.stop} className="flex h-11 items-center gap-1.5 rounded-full bg-danger px-3 text-white">
          <Square size={14} fill="currentColor" />
          <span className="num text-[13px] font-semibold">0:{String(secs).padStart(2, "0")}</span>
        </button>
      ) : (
        <button type="button" onClick={start} disabled={state === "sending"} aria-label={state === "sending" ? labels.working : labels.record} title={labels.note} className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-ink-2 hover:text-ink disabled:opacity-60">
          {state === "sending" ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
        </button>
      )}
      {error && (
        <p role="alert" className="absolute bottom-full right-0 mb-2 w-64 rounded-xl bg-danger-soft px-3 py-2 text-[12px] text-danger shadow-card">
          {error}
        </p>
      )}
    </div>
  );
}

/** Read a message aloud with the phone's own voice: nothing leaves the device. */
export function ListenButton({ text, lang, labels, className }: { text: string; lang: Lang; labels: { listen: string; stop: string }; className?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => () => {
    if (speaking) window.speechSynthesis.cancel();
  }, [speaking]);
  if (!supported) return null;
  const toggle = () => {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const want = SPEECH_LANG[lang];
    const voice = synth.getVoices().find((v) => v.lang === want) ?? synth.getVoices().find((v) => v.lang.startsWith(want.slice(0, 2)));
    u.lang = voice?.lang ?? (lang === "ur" ? "en-GB" : want);
    if (voice) u.voice = voice;
    u.rate = 0.98;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={speaking} className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-ink-3 hover:bg-surface-3 hover:text-ink", className)}>
      {speaking ? <VolumeX size={12} /> : <Volume2 size={12} />} {speaking ? labels.stop : labels.listen}
    </button>
  );
}

import OpenAI from "openai";
import { providerConfig } from "@/server/agent/llm";
import { sessionId } from "@/server/session";

// Voice notes: the family speaks, OpenAI's speech-to-text writes it down (DeepSeek has no speech model),
// and the text is sent like a typed message. Only the transcript is kept; the audio isn't stored.
const MAX_BYTES = 2 * 1024 * 1024; // about two minutes of compressed speech
const PER_VISITOR = Number(process.env.KINWARDEN_VOICE_PER_VISITOR ?? 15);
const g = globalThis as unknown as { __kinwardenVoice?: { day: string; by: Map<string, number> } };
const used = (g.__kinwardenVoice ??= { day: "", by: new Map() });
const LANG: Record<string, string> = { zh: "zh", en: "en", ur: "ur" };

export async function POST(request: Request) {
  const cfg = providerConfig("openai");
  if (!cfg.apiKey) return Response.json({ error: "Voice notes need the OpenAI key on the server. Type your message instead." }, { status: 503 });
  const sid = sessionId(request);
  const today = new Date().toISOString().slice(0, 10);
  if (used.day !== today) Object.assign(used, { day: today, by: new Map() });
  if ((used.by.get(sid) ?? 0) >= PER_VISITOR) return Response.json({ error: "That's all the voice notes for today in this demo. Type your message instead." }, { status: 429 });

  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return Response.json({ error: "No recording received." }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "That recording is too long. Keep voice notes under two minutes." }, { status: 413 });
  const language = LANG[String(form?.get("lang") ?? "")];

  used.by.set(sid, (used.by.get(sid) ?? 0) + 1);
  const client = new OpenAI({ apiKey: cfg.apiKey, timeout: 60_000, maxRetries: 1 });
  const file = new File([await audio.arrayBuffer()], audio.name || "voice.webm", { type: audio.type || "audio/webm" });
  for (const model of ["gpt-4o-mini-transcribe", "whisper-1"]) {
    try {
      const r = await client.audio.transcriptions.create({ file, model, ...(language ? { language } : {}) });
      const text = r.text.trim();
      if (!text) return Response.json({ error: "Couldn't hear anything. Try again a little closer to the microphone." }, { status: 422 });
      return Response.json({ text, model });
    } catch (err) {
      // a model this account can't use: try the next one; anything else is a real failure
      if (!(err instanceof OpenAI.APIError) || ![400, 403, 404].includes(err.status ?? 0) || model === "whisper-1") {
        return Response.json({ error: "Couldn't transcribe the recording just now. Type your message instead." }, { status: 502 });
      }
    }
  }
  return Response.json({ error: "Couldn't transcribe the recording." }, { status: 502 });
}

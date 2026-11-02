// Voiceover for the demo video with OpenAI TTS (the key is read from .env.local, never printed).
//   node scripts/video/tts.mjs samples [voice]    # scene 1 in several voices (or one) -> video/out/samples/
//   node scripts/video/tts.mjs part <id> [voice]  # one narration part only, e.g. 5b (the others are kept)
//   node scripts/video/tts.mjs scenes [voice]     # every scene of docs/internal/VIDEO_SCRIPT.md (kept out of git) (default cedar) -> video/out/voice/
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "video", "out");
const env = Object.fromEntries(
  (fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8") : "")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
let client;

export const DIRECTION =
  "Calm, warm documentary narrator. Unhurried pace, about 140 words a minute, with a short pause after each sentence. Clear and sincere, never salesy or excited. Numbers spoken plainly.";

/** Scene id -> narration text, read from the script (lines starting with "> " under each "## n · title"). */
export function scenesFromScript() {
  const text = fs.readFileSync(path.join(ROOT, "docs", "internal", "VIDEO_SCRIPT.md"), "utf8");
  const scenes = [];
  let cur = null;
  let part = "";
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^## (\d+) · (.+?) \(/);
    if (h) {
      cur = { id: h[1], title: h[2], parts: [] };
      scenes.push(cur);
      part = "";
      continue;
    }
    if (line.startsWith("## ")) cur = null;
    const sub = line.match(/^\*(\d+[a-z]) · (.+)\*$/);
    if (sub) part = sub[1];
    if (cur && line.startsWith("> ")) cur.parts.push({ id: part || cur.id, text: line.slice(2).trim() });
  }
  return scenes;
}

async function speak(text, voice, file) {
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY });
  const r = await client.audio.speech.create({ model: "gpt-4o-mini-tts", voice, input: text, instructions: DIRECTION, response_format: "mp3" });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

// run as a command only when executed directly (edit.mjs imports scenesFromScript)
const [cmd, arg] = import.meta.url === pathToFileURL(process.argv[1] ?? "").href ? process.argv.slice(2) : [null];
if (cmd === null) {
  // imported
} else if (cmd === "samples") {
  const s1 = scenesFromScript()[0].parts.map((p) => p.text).join(" ");
  for (const voice of (arg ? [arg] : ["sage", "coral", "ash", "onyx"])) console.log(path.relative(ROOT, await speak(s1, voice, path.join(OUT, "samples", `scene1-${voice}.mp3`))));
} else if (cmd === "scenes") {
  const voice = arg ?? "cedar";
  for (const s of scenesFromScript()) for (const p of s.parts) console.log(path.relative(ROOT, await speak(p.text, voice, path.join(OUT, "voice", `${p.id}.mp3`))));
} else if (cmd === "part") {
  const id = arg;
  const p = scenesFromScript().flatMap((s) => s.parts).find((x) => x.id === id);
  if (!p) throw new Error(`No narration part ${id} in the script`);
  console.log(path.relative(ROOT, await speak(p.text, process.argv[4] ?? "cedar", path.join(OUT, "voice", `${p.id}.mp3`))));
} else {
  console.log("commands: samples | part <id> [voice] | scenes <voice>");
}

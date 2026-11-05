// Assembles the demo video from the raw takes (record.mjs) and the voice (tts.mjs).
//   node scripts/video/edit.mjs            -> video/out/kinwarden-demo-clean.mp4 (no burned subtitles, an English track)
//                                             video/out/kinwarden-demo-captioned.mp4 (English subtitles in a band below the picture)
//                                             + subtitles.en.srt
//   node scripts/video/edit.mjs --voice video/out/voice-gemini --tag gemini
//                                          -> another voice (any .wav/.mp3 per part, silence trimmed): kinwarden-demo-gemini.mp4
// Each narration part gets a stretch of a take between two markers, sped up to fit the voice (or held
// on its last frame); title and end cards are rendered in Chrome; music is composed with ffmpeg and
// turned down under the voice.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { scenesFromScript } from "./tts.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "video", "out");
const TAKES = path.join(OUT, "takes");
const WORK = path.join(OUT, "edit");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FPS = 30;
const TITLE = 3.2; // opening card, music only
const LEAD = 0.8; // first picture before the first word
const GAP_SHORT = 0.6; // between parts of one scene
const GAP_LONG = 1.4; // between scenes
const END = 5.5; // end card

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const VOICE_DIR = arg("--voice") ? path.resolve(arg("--voice")) : path.join(OUT, "voice");
const TAG = arg("--tag") ? `-${arg("--tag")}` : "";

const ff = (args, cwd = OUT) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { cwd, stdio: ["ignore", "inherit", "inherit"] });
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// Which stretch of which take illustrates each narration part. Markers come from the take's JSON;
// "name+2" / "name-1" shift a marker by seconds; a number is seconds from the start.
const EDL = {
  "1": { take: "s1", from: 0, to: "done", pushIn: true },
  "2": { take: "s2", from: 0, to: "done" },
  "3a": { take: "s3", from: "deposit-1", to: "transfer+2" },
  "3b": { take: "s3", from: "urgent-0.5", to: "scam" },
  "3c": { take: "s3", from: "scam-0.3", to: "discharge" },
  "3d": { take: "s3", from: "discharge", to: "results+2.5" },
  "4": { take: "s4", from: 0, to: "done" },
  "5": { take: "s5", from: 0, to: "done" },
  // filmed on the public site: the seconds the request spends on the network are cut out
  "5b": { take: "s5b", from: 0, to: "done", cut: ["security+1.8", "blocked-1"] },
  "6": { take: "s6", from: 0, to: "done" },
  "7": { take: "s7", from: 0, to: "done" },
  "8": { take: "s8", from: "corridors-0.3", to: "end" },
};

function at(markers, v) {
  if (typeof v === "number") return v;
  const m = v.match(/^([a-z0-9]+)([+-][\d.]+)?$/i);
  if (!m || markers[m[1]] === undefined) throw new Error(`marker ${v} missing`);
  return Math.max(0, markers[m[1]] + Number(m[2] ?? 0));
}

async function cards() {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const shell = (body) => `<!doctype html><html><head><style>
    body{margin:0;width:1920px;height:1080px;background:radial-gradient(1200px 700px at 70% 40%,#0e3b33 0%,#08100f 60%);color:#e9f1ee;font-family:"Segoe UI",system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
    .wrap{text-align:center}.logo{display:inline-flex;align-items:center;gap:22px;font-size:96px;font-weight:700;letter-spacing:-2px}
    .mark{width:110px;height:110px;border-radius:28px;background:#0e6b5c;display:grid;place-items:center}
    .pay{color:#5ccdb4}.tag{margin-top:34px;font-size:40px;color:#c9d6d2}.small{margin-top:70px;font-size:30px;color:#9fb2ad;line-height:1.6}
    .url{font-size:44px;color:#5ccdb4;font-weight:600}</style></head><body><div class="wrap">${body}</div></body></html>`;
  const logo = `<div class="logo"><span class="mark"><svg width="64" height="64" viewBox="0 0 24 24" fill="none"><path d="M5 15.5C7 10 17 10 19 15.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="5.5" cy="16" r="2.4" fill="#fff"/><circle cx="18.5" cy="16" r="2.4" fill="#5ccdb4"/></svg></span><span>Kin<span class="pay">warden</span></span></div>`;
  await page.setContent(shell(`${logo}<div class="tag">An AI agent for hospital and university bills abroad</div>`));
  await page.screenshot({ path: path.join(WORK, "card-title.png") });
  await page.setContent(
    shell(`${logo}<div class="tag">Never carry cash across borders again.</div><div class="small"><span class="url">localhost:3000</span><br/>github.com/JahanzaibMohsin9/kinwarden<br/>Sandbox demo: fictional hospitals, universities and banks. No real money moves.</div>`),
  );
  await page.screenshot({ path: path.join(WORK, "card-end.png") });
  await browser.close();
}

function cardClip(png, seconds, file) {
  ff(["-loop", "1", "-t", String(seconds), "-i", png, "-vf", `fps=${FPS},format=yuv420p,fade=t=in:st=0:d=0.6,fade=t=out:st=${seconds - 0.6}:d=0.6`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", file]);
}

/** The music bed: a slow pad (Am9 – Fmaj7 – C – G) with a little detune and echo, long enough for the film. */
function music(seconds, file) {
  const chords = [
    [110.0, 164.81, 196.0, 246.94, 261.63], // Am9
    [87.31, 130.81, 164.81, 220.0, 261.63], // Fmaj7
    [130.81, 196.0, 261.63, 329.63, 392.0], // C
    [98.0, 146.83, 196.0, 246.94, 293.66], // G
  ];
  const len = 8;
  const parts = chords.map((c, i) => {
    const expr = c.map((f, j) => `${(0.11 - j * 0.012).toFixed(3)}*(sin(2*PI*${f}*t)+0.6*sin(2*PI*${(f * 1.003).toFixed(3)}*t))`).join("+");
    const f = path.join(WORK, `chord${i}.wav`);
    ff(["-f", "lavfi", "-i", `aevalsrc=${expr}:s=44100:d=${len}`, "-af", `afade=t=in:d=2.5,afade=t=out:st=${len - 2.5}:d=2.5`, f]);
    return f;
  });
  // the progression with crossfades, then looped to length, softened and given some space
  const cycle = path.join(WORK, "cycle.wav");
  ff(["-i", parts[0], "-i", parts[1], "-i", parts[2], "-i", parts[3], "-filter_complex", "[0][1]acrossfade=d=2[a];[a][2]acrossfade=d=2[b];[b][3]acrossfade=d=2[c]", "-map", "[c]", cycle]);
  ff(["-stream_loop", "-1", "-i", cycle, "-t", String(seconds), "-af", `lowpass=f=1400,aecho=0.8:0.6:420|780:0.22|0.12,volume=0.55,afade=t=in:d=3,afade=t=out:st=${seconds - 4}:d=4`, file]);
}

/** Subtitle cues: each part's sentences, timed by length within the part's voice. */
function cuesOf(parts) {
  const cues = [];
  for (const p of parts) {
    const sentences = p.text.match(/[^.!?]+[.!?]+["”]?|[^.!?]+$/g).map((x) => x.trim()).filter(Boolean);
    // split very long sentences at commas so a cue stays on two lines
    const chunks = sentences.flatMap((s) => (s.length > 95 ? s.split(/(?<=,)\s+/).reduce((acc, piece) => (acc.length && (acc.at(-1) + " " + piece).length <= 95 ? [...acc.slice(0, -1), acc.at(-1) + " " + piece] : [...acc, piece]), []) : [s]));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    let t = p.voiceStart;
    for (const c of chunks) {
      const d = (p.voice * c.length) / total;
      cues.push({ start: t, end: t + d - 0.05, text: c });
      t += d;
    }
  }
  return cues;
}

const ts = (s) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(r).padStart(3, "0")}`;
};
const writeSrt = (cues, file, text = (c) => c.text) => fs.writeFileSync(file, cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${text(c)}\n`).join("\n"));

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
await cards();

// the timeline: title card, then each part = (lead-in) + voice + gap, then the end card
const scenes = scenesFromScript();
const parts = scenes.flatMap((s, si) => s.parts.map((p, pi) => ({ ...p, scene: s.id, lastInScene: pi === s.parts.length - 1, firstInScene: pi === 0, lastOverall: si === scenes.length - 1 && pi === s.parts.length - 1 })));
// each part's voice file; from another voice folder, leading and trailing silence is trimmed first
fs.mkdirSync(path.join(WORK, "voice"), { recursive: true });
for (const p of parts) {
  const src = [".mp3", ".wav", ".m4a", ".ogg", ".flac"].map((x) => path.join(VOICE_DIR, `${p.id}${x}`)).find((f) => fs.existsSync(f));
  if (!src) throw new Error(`No voice for part ${p.id} in ${VOICE_DIR} (expected ${p.id}.wav or ${p.id}.mp3)`);
  if (!TAG) p.voiceFile = src;
  else {
    p.voiceFile = path.join(WORK, "voice", `${p.id}${TAG}.wav`);
    const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05";
    ff(["-i", src, "-af", `${trim},areverse,${trim},areverse,aresample=44100`, "-ac", "1", p.voiceFile]);
  }
}
let clock = TITLE;
for (const [i, p] of parts.entries()) {
  p.voice = dur(p.voiceFile);
  p.lead = i === 0 ? LEAD : 0;
  p.gap = p.lastOverall ? 1.6 : p.lastInScene ? GAP_LONG : GAP_SHORT;
  p.length = p.lead + p.voice + p.gap;
  p.start = clock;
  p.voiceStart = clock + p.lead;
  clock += p.length;
}
const total = clock + END;

// picture
const list = [];
cardClip(path.join(WORK, "card-title.png"), TITLE, path.join(WORK, "00-title.mp4"));
list.push("00-title.mp4");
for (const p of parts) {
  const e = EDL[p.id];
  const markers = JSON.parse(fs.readFileSync(path.join(TAKES, `${e.take}.json`), "utf8"));
  const from = at(markers, e.from);
  const to = Math.min(at(markers, e.to), markers.end);
  // an optional cut: a stretch inside the segment that is dropped (e.g. waiting on the network)
  const cut = e.cut ? [at(markers, e.cut[0]) - from, at(markers, e.cut[1]) - from] : null;
  const seg = Math.max(0.5, to - from - (cut ? cut[1] - cut[0] : 0));
  // fit to the voice: speed up a long stretch; slow a short one down to 0.7× at most, then hold its last frame
  const speed = Math.max(0.7, seg / p.length);
  const shown = seg / speed;
  const filters = [];
  if (cut) filters.push(`select='not(between(t,${cut[0].toFixed(3)},${cut[1].toFixed(3)}))'`, `setpts=N/${FPS}/TB`);
  filters.push(`setpts=(PTS-STARTPTS)/${speed.toFixed(4)}`, `fps=${FPS}`);
  if (shown < p.length) filters.push(`tpad=stop_mode=clone:stop_duration=${(p.length - shown + 0.1).toFixed(3)}`);
  filters.push(`trim=duration=${p.length.toFixed(3)}`);
  // a slow push into the map, centred between the two cities on the route, kept inside the frame
  if (e.pushIn) filters.push(`zoompan=z='min(1+0.0012*on,1.45)':x='min(iw-iw/zoom,max(0,iw*0.70-iw/zoom/2))':y='min(ih-ih/zoom,max(0,ih*0.33-ih/zoom/2))':d=1:s=1920x1080:fps=${FPS}`);
  if (p.firstInScene) filters.push("fade=t=in:st=0:d=0.35");
  if (p.lastInScene) filters.push(`fade=t=out:st=${(p.length - 0.35).toFixed(3)}:d=0.35`);
  filters.push("format=yuv420p");
  const file = `p-${p.id}.mp4`;
  ff(["-ss", String(from), "-i", path.join(TAKES, `${e.take}.mp4`), "-an", "-vf", filters.join(","), "-c:v", "libx264", "-preset", "medium", "-crf", "18", path.join(WORK, file)]);
  list.push(file);
  console.log(`${p.id.padEnd(3)} ${e.take} ${from.toFixed(1)}–${to.toFixed(1)}s → ${p.length.toFixed(1)}s (×${speed.toFixed(2)})`);
}
cardClip(path.join(WORK, "card-end.png"), END, path.join(WORK, "99-end.mp4"));
list.push("99-end.mp4");
fs.writeFileSync(path.join(WORK, "list.txt"), list.map((f) => `file '${f}'`).join("\n"));
ff(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "picture.mp4"], WORK);

// sound: the voice parts at their places, the music ducked under them
const voiceInputs = parts.flatMap((p) => ["-i", p.voiceFile]);
const delays = parts.map((p, i) => `[${i}:a]aresample=44100,adelay=${Math.round(p.voiceStart * 1000)}:all=1[v${i}]`).join(";");
ff([...voiceInputs, "-filter_complex", `${delays};${parts.map((_, i) => `[v${i}]`).join("")}amix=inputs=${parts.length}:normalize=0,apad=whole_dur=${total}[v]`, "-map", "[v]", "-ac", "2", path.join(WORK, "voice.wav")]);
music(total, path.join(WORK, "music.wav"));
ff(["-i", "voice.wav", "-i", "music.wav", "-filter_complex", "[1:a]volume=0.32[m];[m][0:a]sidechaincompress=threshold=0.015:ratio=6:attack=40:release=600[md];[0:a][md]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]", "-map", "[a]", "-t", String(total), "mix.wav"], WORK);

// subtitles: English
const cues = cuesOf(parts);
writeSrt(cues, path.join(WORK, "subtitles.en.srt"));
fs.copyFileSync(path.join(WORK, "subtitles.en.srt"), path.join(OUT, TAG ? `subtitles.en${TAG}.srt` : "subtitles.en.srt"));

// 1. clean, for YouTube and X: no burned subtitles, so nothing covers the app; English rides along as a
//    switchable track (and the .srt file is uploaded as captions)
const clean = `kinwarden-demo-clean${TAG}.mp4`;
ff(
  [
    ...["-i", "picture.mp4", "-i", "mix.wav", "-i", "subtitles.en.srt"],
    ...["-map", "0:v", "-map", "1:a", "-map", "2:s"],
    ...["-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-c:s", "mov_text"],
    ...["-metadata:s:s:0", "language=eng", "-metadata:s:s:0", "title=English"],
    // no -shortest here: the subtitle track ends before the end card
    ...["-movflags", "+faststart", "-t", total.toFixed(3), path.join(OUT, clean)],
  ],
  WORK,
);

// 2. captioned, for players without subtitle tracks: the picture a little smaller, English subtitles in a band below it
const BAND = { w: 1600, h: 900, color: "0x0b1412" };
const band = `kinwarden-demo-captioned${TAG}.mp4`;
const style = "FontName=Arial,FontSize=12,PrimaryColour=&H00F4F1EA,OutlineColour=&H00000000,BorderStyle=1,Outline=0.5,Shadow=0,Alignment=2,MarginV=8,MarginL=28,MarginR=28";
ff(
  [
    ...["-i", "picture.mp4", "-i", "mix.wav"],
    ...["-vf", `scale=${BAND.w}:${BAND.h}:flags=lanczos,pad=1920:1080:${(1920 - BAND.w) / 2}:0:color=${BAND.color},subtitles=subtitles.en.srt:force_style='${style}'`],
    ...["-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", path.join(OUT, band)],
  ],
  WORK,
);
for (const f of [clean, band]) console.log(`${f}: ${dur(path.join(OUT, f)).toFixed(1)}s`);

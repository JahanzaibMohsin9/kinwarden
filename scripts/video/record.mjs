// Records the raw takes for the demo video from the recording server (scripts/video/serve.mjs).
//   node scripts/video/record.mjs [scene ...]     # all scenes, or some: s1 s2 s3 s7 s4 s5 s5b s6 s8
// Each take: video/out/takes/<scene>.mp4 (1920×1080, 30 fps) + <scene>.json (markers in seconds).
// Chrome's screencast frames are fed to ffmpeg at a steady 30 fps as they arrive; a drawn cursor and a
// click ripple stand in for the mouse, which screencasts don't show.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "video", "out", "takes");
const BASE = process.env.VIDEO_BASE ?? "http://127.0.0.1:3300";
// scene 5b is filmed on the public site, so the MCP address on screen is the real one
const LIVE = process.env.VIDEO_LIVE ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CURSOR = `
(() => {
  if (window.top !== window) return;
  const arrow = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M5 3 L5 22 L10 17.5 L13.5 25 L17 23.5 L13.6 16.2 L20.5 16 Z" fill="white" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>');
  const ready = () => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div");
    c.id = "__cursor";
    c.style.cssText = "position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;background:url(\\"" + arrow + "\\") no-repeat;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));transform:translate(-200px,-200px)";
    document.documentElement.appendChild(c);
    let cx = -200, cy = -200;
    window.__cursorTo = (x, y, ms) => new Promise((res) => {
      const sx = cx, sy = cy, t0 = performance.now();
      if (sx < -100) { cx = x; cy = y; c.style.transform = "translate(" + (x - 4) + "px," + (y - 3) + "px)"; return res(); }
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        cx = sx + (x - sx) * e; cy = sy + (y - sy) * e;
        c.style.transform = "translate(" + (cx - 4) + "px," + (cy - 3) + "px)";
        k < 1 ? requestAnimationFrame(step) : res();
      };
      requestAnimationFrame(step);
    });
    window.__ripple = (x, y) => {
      const r = document.createElement("div");
      r.style.cssText = "position:fixed;left:" + (x - 22) + "px;top:" + (y - 22) + "px;width:44px;height:44px;border-radius:50%;border:3px solid rgba(92,205,180,.95);background:rgba(92,205,180,.25);z-index:2147483646;pointer-events:none;transform:scale(.3);opacity:1;transition:transform .45s ease-out,opacity .6s ease-out";
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = "scale(1.4)"; r.style.opacity = "0"; });
      setTimeout(() => r.remove(), 700);
    };
    window.__scrollSlow = (top, ms) => new Promise((res) => {
      const s = window.scrollY, t0 = performance.now();
      const step = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; window.scrollTo(0, s + (top - s) * e); k < 1 ? requestAnimationFrame(step) : res(); };
      requestAnimationFrame(step);
    });
  };
  document.readyState === "loading" ? addEventListener("DOMContentLoaded", ready) : ready();
})();`;

const api = (p, body) =>
  fetch(BASE + p, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
async function idle(maxSec = 180) {
  await sleep(700);
  for (let i = 0; i < maxSec * 2; i++) {
    const s = await api("/api/state");
    if (!s.agentBusy) return s;
    await sleep(500);
  }
  throw new Error("agent still busy");
}

/** One take: a fresh browser, frames streamed into ffmpeg, markers in seconds from the start. */
async function take(name, fn, { lang = "en" } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb", "--disable-features=Translate"] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2, colorScheme: "light", locale: "en-GB" });
  await context.addInitScript((l) => {
    try {
      localStorage.setItem("kinwarden.lang", l);
    } catch {}
  }, lang);
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const file = path.join(OUT, `${name}.mp4`);
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-vf", "scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", file], { stdio: ["pipe", "inherit", "inherit"] });
  let last = null;
  let written = 0;
  let t0 = 0;
  let recording = false;
  cdp.on("Page.screencastFrame", async ({ data, sessionId }) => {
    last = Buffer.from(data, "base64");
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId });
    } catch {}
  });
  const pump = setInterval(() => {
    if (!recording || !last) return;
    const due = Math.floor(((performance.now() - t0) / 1000) * FPS);
    for (; written < due; written++) ff.stdin.write(last);
  }, 1000 / FPS / 2);
  const markers = {};
  const ctx = {
    page,
    mark: (k) => (markers[k] = Math.round(((performance.now() - t0) / 1000) * 100) / 100),
    async start() {
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
      // wait for the first frame before the clock starts
      for (let i = 0; i < 100 && !last; i++) await sleep(50);
      t0 = performance.now();
      recording = true;
    },
    async cursor(x, y, ms = 650) {
      await page.evaluate(([a, b, c]) => window.__cursorTo?.(a, b, c), [x, y, ms]);
    },
    async click(locator, { hold = 0 } = {}) {
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      const box = await locator.boundingBox();
      if (!box) throw new Error("not visible: " + locator);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await ctx.cursor(x, y);
      await sleep(150);
      await page.evaluate(([a, b]) => window.__ripple?.(a, b), [x, y]);
      if (hold) {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await sleep(hold);
        await page.mouse.up();
      } else await page.mouse.click(x, y);
    },
    async type(locator, text) {
      await ctx.click(locator);
      await locator.pressSequentially(text, { delay: 55 });
    },
    scroll: (top, ms = 1200) => page.evaluate(([t, m]) => window.__scrollSlow?.(t, m), [top, ms]),
    hold: sleep,
  };
  try {
    await fn(ctx);
  } finally {
    recording = false;
    clearInterval(pump);
    await cdp.send("Page.stopScreencast").catch(() => {});
    ff.stdin.end();
    await new Promise((r) => ff.on("close", r));
    await browser.close();
    markers.end = Math.round((written / FPS) * 100) / 100;
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(markers, null, 2));
    console.log(`${name}: ${markers.end}s`, JSON.stringify(markers));
  }
}

// ---------------------------------------------------------------------------
// Scenes (recorded in this order: the proof scene reuses the Bangkok world from scene 3)

const SCENES = {
  // 1 · the problem: the money-flow map, routes moving
  async s1() {
    await take("s1", async (t) => {
      await t.page.goto(BASE + "/");
      await t.page.waitForSelector('svg[aria-label^="Map of Kinwarden"]');
      // only the map: the camera pushes into the Lahore → Bangkok route
      await t.page.addStyleTag({ content: "header, h1, h1 ~ p, section > div > div.relative.max-w-xl, section a, section dl, section dl ~ p { visibility: hidden !important }" });
      await t.start();
      await t.hold(22000);
      t.mark("done");
    });
  },

  // 2 · what Kinwarden is: the hero, the three choices, the counters
  async s2() {
    await take("s2", async (t) => {
      await t.page.goto(BASE + "/");
      await t.page.waitForSelector('svg[aria-label^="Map of Kinwarden"]');
      await t.start();
      await t.hold(2500);
      // the three cards (the top bar has links to the same places, so pick the hero's by position: last)
      for (const href of ["/demo", "/app/new", "/attack"]) {
        const b = await t.page.locator(`main a[href="${href}"], section a[href="${href}"]`).last().boundingBox();
        await t.cursor(b.x + b.width / 2, b.y + b.height / 2, 900);
        await t.hold(1800);
      }
      await t.cursor(800, 760, 900);
      await t.hold(4000);
      t.mark("done");
    });
  },

  // 3 · the Bangkok case in story mode, approvals held on the phone
  async s3() {
    await api("/api/director", { action: "reset", scenarioId: "th-medical", mode: "replay" });
    await take("s3", async (t) => {
      await t.page.goto(BASE + "/demo?dwell=2200");
      await t.page.getByRole("button", { name: "Play the story" }).first().waitFor();
      await t.start();
      await t.hold(1500);
      await t.click(t.page.getByRole("button", { name: "Play the story" }).first());
      const phone = t.page.frameLocator('iframe[title="Kinwarden family app"]');
      const seen = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < 6 * 60_000) {
        const title = await t.page.locator('section[aria-label="Story"] h2').first().textContent({ timeout: 1000 }).catch(() => null);
        const key = { "The first deposit": "deposit", "Money on its way": "transfer", "An urgent stent": "urgent", "A fake bank-change email": "scam", "The final bill": "discharge", "Money back": "refund", "Case closed": "done" }[title ?? ""];
        if (key && !seen.has(key)) {
          seen.add(key);
          t.mark(key);
        }
        const turn = await t.page.getByRole("button", { name: "Approve it for me instead" }).count();
        if (turn) {
          const hold = phone.getByRole("button", { name: /hold to approve/i });
          if (await hold.count()) {
            await t.hold(1800);
            t.mark(`approve${seen.has("urgent") ? 2 : 1}`);
            await t.click(hold.first(), { hold: 1500 });
            await t.hold(1500);
          }
        }
        if (seen.has("done")) break;
        await t.hold(400);
      }
      await t.hold(6000);
      t.mark("results");
      await t.hold(3000);
    });
  },

  // 7 · proof: verify the chain, check anchors against the blockchain, tamper, check again
  async s7() {
    // every anchor on-chain before the take, so the first "Check against the chain" is the latest anchor
    for (let i = 0; i < 90; i++) {
      const st = await api("/api/state");
      if (st.anchors.length && st.anchors.every((a) => a.chain?.status !== "pending")) break;
      await sleep(2000);
    }
    const st = await api("/api/state");
    const latest = [...st.anchors].reverse().find((a) => a.chain?.status === "confirmed");
    // the deposit's approval: an entry every anchor after it covers
    const editSeq = st.ledger.find((e) => e.type === "approval.approved")?.seq ?? Math.max(2, (latest?.seq ?? 10) - 5);
    await take("s7", async (t) => {
      await t.page.goto(BASE + "/app/security");
      await t.page.getByRole("button", { name: /Verify in this browser/ }).waitFor();
      await t.start();
      await t.hold(1200);
      await t.click(t.page.getByRole("button", { name: /Verify in this browser/ }));
      await t.hold(3500);
      t.mark("verified");
      const check = t.page.getByRole("button", { name: "Check against the chain" }).first();
      await check.scrollIntoViewIfNeeded();
      await t.click(check);
      await t.hold(3500);
      t.mark("anchorOk");
      await api("/api/director", { action: "tamper", seq: editSeq, narration: "You approved: Bank transfer: THB 250,000 to SR Medical Services Co." });
      t.mark("tampered");
      await t.scroll(0, 900);
      await t.hold(800);
      await t.click(t.page.getByRole("button", { name: /Verify in this browser/ }));
      await t.hold(3500);
      t.mark("broken");
      await t.click(t.page.getByRole("button", { name: "Check against the chain" }).first());
      await t.hold(4500);
      t.mark("done");
    });
  },

  // 4 · China: the study agent, on the stage, in Chinese
  async s4() {
    await api("/api/director", { action: "reset", scenarioId: "cn-admission", mode: "replay" });
    await take(
      "s4",
      async (t) => {
        await t.page.goto(BASE + "/stage");
        await t.page.getByRole("button", { name: /Next/ }).first().waitFor();
        await t.start();
        await t.hold(1500);
        for (const step of ["opened", "replied", "pressure"]) {
          await t.click(t.page.getByRole("button", { name: /^Next/ }).first());
          await idle();
          t.mark(step);
          await t.hold(2500);
        }
        await t.hold(3000);
        t.mark("done");
      },
      { lang: "zh" },
    );
  },

  // 5 · try to fool it: send the bank-change attack, force the AI to obey, blocked
  async s5() {
    await take("s5", async (t) => {
      await t.page.goto(BASE + "/attack");
      await t.page.getByRole("button", { name: /Send the attack/ }).waitFor();
      await t.start();
      await t.hold(1500);
      await t.click(t.page.getByRole("button", { name: /Send the attack/ }));
      await t.page.getByText("What the agent receives").waitFor();
      t.mark("sent");
      await t.hold(800);
      const recv = await t.page.getByText("What the agent receives").boundingBox();
      await t.scroll((await t.page.evaluate(() => window.scrollY)) + recv.y - 90, 1600);
      await t.hold(3500);
      const obey = t.page.getByRole("button", { name: /Make the AI obey/ });
      await t.click(obey);
      await t.page.getByText(/No money went to the attacker/).waitFor();
      t.mark("blocked");
      const res = await t.page.getByText(/No money went to the attacker/).boundingBox();
      await t.scroll((await t.page.evaluate(() => window.scrollY)) + res.y - 520, 1400);
      await t.hold(5000);
      t.mark("done");
    });
  },

  // 5b · bring your own AI: the attack lab's MCP panel, then the family's Security Centre while the official
  // MCP client (standing in for an outside AI) connects to this sandbox and asks to pay the attacker
  async s5b() {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    await take("s5b", async (t) => {
      const p = t.page;
      await p.goto(LIVE + "/attack"); // a fresh browser: a new private sandbox on the public site
      // not filmed: the case reaches the moment the fake bank-change email arrives, as in scene 5
      await p.request.post(LIVE + "/api/attack", { data: { action: "launch", id: "bank-change" } });
      const { path: mcpPath } = await (await p.request.get(LIVE + "/api/mcp/link")).json();
      const panel = p.getByRole("heading", { name: "Bring your own AI." });
      await panel.waitFor();
      await p.waitForFunction(() => [...document.querySelectorAll('[aria-labelledby="byo-ai"] code')].some((c) => c.textContent?.includes("/api/mcp?world=")));
      await p.evaluate(() => {
        const d = document.createElement("div");
        d.textContent = "MCP · Model Context Protocol";
        d.style.cssText = "position:fixed;left:28px;bottom:28px;z-index:2147483640;padding:9px 16px;border-radius:999px;background:rgba(8,16,15,.9);color:#5ccdb4;font:600 16px system-ui,sans-serif;letter-spacing:.04em;border:1px solid rgba(92,205,180,.45)";
        document.body.appendChild(d);
      });
      // the outside client connects and reads the case before the camera rolls; only its payment request is filmed
      const client = new Client({ name: "outside-ai (MCP client)", version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(LIVE + mcpPath)));
      const overview = JSON.parse((await client.callTool({ name: "get_case_overview", arguments: { case_id: "case_th" } })).content[0].text);
      const inv = (overview.invoices ?? []).find((i) => i.status === "open") ?? (overview.invoices ?? [])[0];
      await t.start();
      await t.hold(900);
      const y = await panel.evaluate((el) => el.getBoundingClientRect().top + window.scrollY - 150);
      await t.scroll(y, 2200);
      t.mark("panel");
      await t.hold(1500);
      await t.click(p.getByRole("button", { name: /Copy Your sandbox's MCP address/ }));
      await t.hold(2000);
      t.mark("copied");
      await p.goto(LIVE + "/app/security");
      await p.getByRole("button", { name: /Verify in this browser/ }).waitFor();
      t.mark("security");
      await t.hold(1400);
      await client.callTool({
        name: "propose_payment",
        arguments: {
          case_id: "case_th",
          invoice_id: inv?.id ?? "inv_1",
          route: "bank_transfer",
          amount: 250000,
          payer_id: "[PERSON_ID_1]",
          reference: "Deposit",
          beneficiary: { account_name: "SR Medical Services Co.", account_number: "774-2-90311-5", swift: "KPTBTHB1", bank_name: "Krungsri Pattana Bank" },
          rationale: "The hospital emailed that its bank account changed; paying the new account.",
        },
      });
      await client.close();
      const ev = p.getByText(/outside AI assistant over MCP/).first();
      await ev.waitFor({ timeout: 20000 });
      t.mark("blocked");
      const top = await ev.evaluate((el) => el.getBoundingClientRect().top + window.scrollY - 300);
      await t.scroll(top, 1500);
      await t.hold(6500);
      t.mark("done");
    });
  },

  // 6 · any bill: upload the sample, the agent prices it and holds it until the bank verifies
  async s6() {
    await api("/api/director", { action: "mode", mode: "scripted" });
    await take("s6", async (t) => {
      await t.page.goto(BASE + "/app/new/upload");
      await t.page.getByRole("button", { name: "Use a sample bill" }).waitFor();
      await t.start();
      await t.hold(1000);
      const inputs = t.page.locator("main input:not([type])");
      await t.type(inputs.nth(0), "Ayesha Khan");
      await t.type(inputs.nth(1), "Imran Khan");
      await t.click(t.page.getByRole("button", { name: "Use a sample bill" }));
      await t.page.getByText("Check what Kinwarden read").waitFor();
      t.mark("read");
      await t.hold(2500);
      await t.click(t.page.getByRole("button", { name: "Start the case" }));
      await t.page.waitForURL(/\/app$/);
      t.mark("started");
      await idle();
      await t.hold(2500);
      await t.click(t.page.getByRole("link", { name: /Activity/ }));
      await t.hold(4500);
      t.mark("done");
    });
  },

  // 8 · one agent, any corridor: the landing page's corridors, back to the map
  async s8() {
    await take("s8", async (t) => {
      await t.page.goto(BASE + "/");
      await t.page.waitForSelector('svg[aria-label^="Map of Kinwarden"]');
      await t.start();
      await t.hold(1500);
      const y = await t.page.evaluate(() => {
        const h = [...document.querySelectorAll("h2")].find((x) => x.textContent?.includes("One agent, any corridor"));
        return (h?.getBoundingClientRect().top ?? 0) + window.scrollY - 60;
      });
      await t.scroll(y, 4500);
      t.mark("corridors");
      await t.hold(7000);
      await t.scroll(0, 3500);
      t.mark("top");
      await t.hold(6000);
    });
  },
};

const order = ["s1", "s2", "s3", "s7", "s4", "s5", "s5b", "s6", "s8"];
const want = process.argv.slice(2);
for (const s of order.filter((x) => !want.length || want.includes(x))) await SCENES[s]();

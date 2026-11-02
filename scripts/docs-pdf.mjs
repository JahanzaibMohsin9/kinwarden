// Turns the submission documents into PDFs: docs/pdf/<NAME>.pdf
//   node scripts/docs-pdf.mjs                 # TECHNICAL, SECURITY, PRODUCTION, EVAL
//   node scripts/docs-pdf.mjs TECHNICAL       # one document
// Relative links become links to the GitHub repository, so they work in the PDF.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = path.join(ROOT, "docs");
const OUT = path.join(DOCS, "pdf");
const REPO = "https://github.com/JahanzaibMohsin9/kinwarden/blob/main/";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const names = process.argv.slice(2).length ? process.argv.slice(2) : ["TECHNICAL", "SECURITY", "PRODUCTION", "EVAL"];

const css = `
@page { size: A4; margin: 18mm 16mm 20mm; }
body { font-family: "Segoe UI", "Microsoft YaHei", Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #1d2a27; }
h1 { font-size: 22pt; color: #0e1f1c; margin: 0 0 4pt; }
h2 { font-size: 14pt; color: #12705f; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #d9e4e0; break-after: avoid; }
h3 { font-size: 11pt; color: #0e1f1c; margin: 12pt 0 4pt; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
a { color: #12705f; text-decoration: none; }
code { font-family: Consolas, "Courier New", monospace; font-size: 8.8pt; background: #f1efe9; padding: 0 2pt; border-radius: 2pt; }
pre { background: #f6f4ef; border: 1px solid #e2dccf; border-radius: 4pt; padding: 8pt 10pt; font-size: 8.4pt; line-height: 1.3; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: inherit; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 8.8pt; break-inside: auto; }
tr { break-inside: avoid; }
th, td { border: 1px solid #d9e4e0; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { background: #eaf3f0; }
blockquote { margin: 8pt 0; padding: 4pt 10pt; border-left: 3pt solid #3fb8a5; background: #f3f8f6; }
img { max-width: 100%; }
`;

// Relative links point to GitHub; local images are embedded for reliable PDF export.
function absolutize(md, file) {
  const dir = path.dirname(file);
  return md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, bang, label, href) => {
    if (/^(https?:|mailto:|data:|#)/.test(href)) return m;
    const abs = path.resolve(dir, href);
    if (bang) {
      const mime = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" }[path.extname(abs).toLowerCase()];
      if (!mime) throw new Error(`Unsupported image type: ${abs}`);
      return `![${label}](data:${mime};base64,${fs.readFileSync(abs).toString("base64")})`;
    }
    return `[${label}](${REPO}${path.relative(ROOT, abs).split(path.sep).join("/")})`;
  });
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
for (const name of names) {
  const file = path.join(DOCS, `${name}.md`);
  const md = absolutize(fs.readFileSync(file, "utf8"), file);
  const title = md.match(/^# (.+)$/m)?.[1] ?? name;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}${name === "EVAL" ? "table { break-inside: avoid; }" : ""}</style></head><body>${marked.parse(md)}</body></html>`;
  const tmp = path.join(OUT, `.${name}.html`);
  fs.writeFileSync(tmp, html);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const brokenImages = await page.locator("img").evaluateAll((images) => images.filter((img) => !img.complete || !img.naturalWidth).map((img) => img.alt));
  if (brokenImages.length) throw new Error(`Images failed to load in ${name}: ${brokenImages.join(", ")}`);
  await page.pdf({
    path: path.join(OUT, `${name}.pdf`),
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font-size:8px;color:#6b7a76;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>Kinwarden · ${title.replace(/^Kinwarden: /, "")}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
  });
  fs.rmSync(tmp);
  console.log(`docs/pdf/${name}.pdf`);
}
await browser.close();

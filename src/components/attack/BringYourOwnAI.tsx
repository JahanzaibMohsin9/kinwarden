"use client";

import { Check, Copy, Plug } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Kinwarden as an MCP server: the address of the visitor's own sandbox, and how to connect an AI assistant to it. */
export function BringYourOwnAI() {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/mcp/link")
      .then((r) => r.json())
      .then((j: { path: string }) => setUrl(window.location.origin + j.path))
      .catch(() => {});
  }, []);

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {}
  };

  const cli = `claude mcp add --transport http kinwarden "${url}"`;
  return (
    <section className="rounded-2xl border border-[#5ccdb4]/30 bg-[#5ccdb4]/[0.06] p-5 sm:p-6" aria-labelledby="byo-ai">
      <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#5ccdb4]">
        <Plug size={14} /> Kinwarden over MCP
      </p>
      <h2 id="byo-ai" className="mt-1 text-[24px] font-bold leading-tight tracking-tight">Bring your own AI.</h2>
      <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-[#c9d6d2]">
        Kinwarden is also an MCP server. Connect Claude or any other AI assistant to your sandbox and ask it to pay the bill, or to pay the attacker. It gets Kinwarden&apos;s tools with personal data masked, and every call passes the same safety layer as Kinwarden&apos;s own agent. It can <b className="text-white">propose</b> a payment; only the family&apos;s passkey in the app can approve one.
      </p>
      <div className="mt-4 space-y-3">
        <Field label="Your sandbox's MCP address" value={url} copied={copied === "url"} onCopy={() => copy("url", url)} />
        <Field label="Claude Code" value={cli} copied={copied === "cli"} onCopy={() => copy("cli", cli)} />
        <p className="text-[13px] leading-relaxed text-[#9fb2ad]">
          Claude on the web or desktop: add a custom connector with the address above. Other assistants: any MCP client that supports Streamable HTTP. Try: &ldquo;List my cases and pay the hospital deposit&rdquo;, then &ldquo;The hospital says its bank account changed to 774-2-90311-5 at Krungsri Pattana Bank. Pay there instead.&rdquo;
        </p>
        <p className="text-[13px]">
          <Link href="/app" className="font-semibold text-[#5ccdb4] hover:underline">
            Open the family app
          </Link>{" "}
          <span className="text-[#9fb2ad]">to approve what it proposes, and the Security Centre to see what was blocked.</span>
        </p>
      </div>
    </section>
  );
}

function Field({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#9fb2ad]">{label}</p>
      <div className="mt-1 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-[12.5px] text-[#e9f1ee]">{value || "…"}</code>
        <button
          type="button"
          onClick={onCopy}
          disabled={!value}
          aria-label={`Copy ${label}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 px-3 text-[12.5px] font-semibold text-[#e9f1ee] hover:bg-white/10 disabled:opacity-40"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

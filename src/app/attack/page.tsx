import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { AttackLab, type Recorded } from "@/components/attack/AttackLab";
import { LAB } from "@/server/attacklab";
import results from "../../../docs/redteam/results.json";
import naive from "../../../docs/redteam/results-naive.json";

export const metadata: Metadata = { title: "Kinwarden · Try to fool it", description: "Launch real attacks at Kinwarden's AI agent and watch the safety layer stop them." };

type Row = { id: string; model?: string; attempted: string | null; executed: string | null; flagged?: boolean; warnedFamily?: boolean; blockedByGateway?: number; toolCalls?: { tool: string; decision: string }[]; seconds?: number };

// what the live model did with each attack in the LLM red team (npm run redteam:llm), read at build time
function recorded(rows: Row[]): Recorded {
  return Object.fromEntries(
    rows.map((r) => [r.id, { model: r.model ?? "", attempted: r.attempted, executed: r.executed, flagged: !!r.flagged, warnedFamily: !!r.warnedFamily, blocked: r.blockedByGateway ?? 0, tools: (r.toolCalls ?? []).map((t) => `${t.tool}:${t.decision}`) }]),
  );
}

export default function Page() {
  const ours = results as Row[];
  const theirs = naive as Row[];
  const summary = {
    total: ours.length,
    attempted: ours.filter((r) => r.attempted).length,
    executed: ours.filter((r) => r.executed).length,
    naiveAttempted: theirs.filter((r) => r.attempted).length,
    naiveExecuted: theirs.filter((r) => r.executed).length,
    model: ours[0]?.model ?? "",
  };
  return (
    <Providers>
      <AttackLab attacks={LAB} recorded={recorded(ours)} naive={recorded(theirs)} summary={summary} />
    </Providers>
  );
}

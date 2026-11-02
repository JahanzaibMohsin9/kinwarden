import { runtime } from "@/server/runtime";
import { verifyChain } from "@/server/hash";
import { sessionId } from "@/server/session";

/** Downloadable execution evidence: every action, hash-chained, plus published anchors. */
export async function GET(request: Request) {
  const { store } = runtime(sessionId(request));
  const body = {
    product: "Kinwarden sandbox execution log",
    scenario: store.world.scenarioId,
    exportedAt: new Date().toISOString(),
    hashAlgorithm: "sha256 over canonical JSON of each entry (sorted keys), chained by prevHash",
    verification: verifyChain(store.ledger),
    anchors: store.anchors,
    entries: store.ledger,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="kinwarden-execution-log-${store.world.scenarioId}.json"`,
    },
  });
}

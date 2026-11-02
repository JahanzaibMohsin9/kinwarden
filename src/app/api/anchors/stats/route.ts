import { createPublicClient, http, type Hex } from "viem";
import { ANCHOR_ABI, ANCHOR_CHAIN, anchorConfig, explorerAddress } from "@/server/anchor/chain";

// How many anchors the contract holds, read from the public chain (cached for a minute).
const g = globalThis as unknown as { __kinwardenAnchorStats?: { at: number; count: number } };

export async function GET() {
  const cfg = anchorConfig();
  if (!cfg) return Response.json({ enabled: false });
  const cached = g.__kinwardenAnchorStats;
  if (!cached || Date.now() - cached.at > 60_000) {
    try {
      const client = createPublicClient({ chain: ANCHOR_CHAIN, transport: http(undefined, { timeout: 8000 }) });
      const count = (await client.readContract({ address: cfg.contract as Hex, abi: ANCHOR_ABI, functionName: "count" })) as bigint;
      g.__kinwardenAnchorStats = { at: Date.now(), count: Number(count) };
    } catch {
      if (!cached) return Response.json({ enabled: true, count: null, contractUrl: explorerAddress(cfg.contract) });
    }
  }
  return Response.json({ enabled: true, count: g.__kinwardenAnchorStats!.count, chain: ANCHOR_CHAIN.name, contractUrl: explorerAddress(cfg.contract) });
}

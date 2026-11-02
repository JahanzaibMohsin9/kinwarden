// The public chain the activity log is anchored to: Conflux eSpace testnet (EVM, chain ID 71). A
// China-built public chain whose explorer opens from mainland China. Only the anchor wallet's key
// signs, only our contract is called, and only hashes go on-chain.
import { createPublicClient, createWalletClient, decodeEventLog, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import artifact from "./artifact.json";

export const ANCHOR_CHAIN = {
  id: 71,
  name: "Conflux eSpace Testnet",
  nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmtestnet.confluxrpc.com"] } },
  blockExplorers: { default: { name: "ConfluxScan", url: "https://evmtestnet.confluxscan.org" } },
} as const;

export const ANCHOR_ABI = artifact.abi;
export const explorerTx = (txHash: string) => `${ANCHOR_CHAIN.blockExplorers.default.url}/tx/${txHash}`;
export const explorerAddress = (address: string) => `${ANCHOR_CHAIN.blockExplorers.default.url}/address/${address}`;

export interface AnchorConfig {
  privateKey: Hex;
  contract: Hex;
}

/** On only when both the testnet key and the deployed contract are set (see scripts/anchor-contract.mjs). */
export function anchorConfig(env: Record<string, string | undefined> = process.env): AnchorConfig | null {
  if (env.ANCHOR_CHAIN && env.ANCHOR_CHAIN !== "conflux-espace-testnet") return null;
  const key = env.ANCHOR_PRIVATE_KEY?.trim();
  const contract = env.ANCHOR_CONTRACT?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !contract || !/^0x[0-9a-fA-F]{40}$/.test(contract)) return null;
  return { privateKey: key as Hex, contract: contract as Hex };
}

export interface OnChainRecord {
  head: string;
  seq: number;
  label: string;
  blockNumber: number;
  contract: string;
}

/** What the anchoring service needs from a chain; tests swap in a fake. */
export interface ChainPublisher {
  chainId: number;
  contract: string;
  publish(a: { head: string; seq: number; label: string }): Promise<string>;
  confirm(txHash: string): Promise<{ ok: boolean; blockNumber: number }>;
  read(txHash: string): Promise<OnChainRecord | null>;
}

export function viemPublisher(cfg: AnchorConfig): ChainPublisher {
  const account = privateKeyToAccount(cfg.privateKey);
  const transport = http(undefined, { timeout: 30_000, retryCount: 2 });
  const wallet = createWalletClient({ account, chain: ANCHOR_CHAIN, transport });
  const reader = createPublicClient({ chain: ANCHOR_CHAIN, transport });
  return {
    chainId: ANCHOR_CHAIN.id,
    contract: cfg.contract,
    publish: ({ head, seq, label }) =>
      wallet.writeContract({ address: cfg.contract, abi: ANCHOR_ABI, functionName: "anchor", args: [`0x${head}`, BigInt(seq), label] }),
    confirm: async (txHash) => {
      const r = await reader.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 120_000 });
      return { ok: r.status === "success", blockNumber: Number(r.blockNumber) };
    },
    read: async (txHash) => {
      const r = await reader.getTransactionReceipt({ hash: txHash as Hex });
      for (const log of r.logs) {
        if (log.address.toLowerCase() !== cfg.contract.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: ANCHOR_ABI, data: log.data, topics: log.topics });
          if (ev.eventName !== "Anchored") continue;
          const args = ev.args as unknown as { head: Hex; seq: bigint; label: string };
          return { head: args.head.slice(2), seq: Number(args.seq), label: args.label, blockNumber: Number(r.blockNumber), contract: log.address };
        } catch {
          // another event
        }
      }
      return null;
    },
  };
}

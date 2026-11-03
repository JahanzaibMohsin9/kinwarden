"use client";

/**
 * The family's own NEAR wallet, through NEAR Connect. We connect without asking the wallet to add a
 * key for the app (docs/near/DECISIONS.md D-03), so every family action is confirmed in the wallet.
 */
import type { NearConnector, NearWalletBase } from "@hot-labs/near-connect";

let connector: Promise<NearConnector> | null = null;

function getConnector(network: "testnet" | "mainnet"): Promise<NearConnector> {
  connector ??= import("@hot-labs/near-connect").then(
    ({ NearConnector }) => new NearConnector({ network, features: { testnet: network === "testnet", signAndSendTransaction: true }, footerBranding: null }),
  );
  return connector;
}

export async function connectedAccount(network: "testnet" | "mainnet"): Promise<string | null> {
  const c = await getConnector(network);
  try {
    const wallet = await c.wallet();
    return (await wallet.getAccounts())[0]?.accountId ?? null;
  } catch {
    return null;
  }
}

export async function connectWallet(network: "testnet" | "mainnet"): Promise<string | null> {
  const c = await getConnector(network);
  const wallet = await c.connect();
  return (await wallet.getAccounts())[0]?.accountId ?? null;
}

export async function disconnectWallet(network: "testnet" | "mainnet") {
  const c = await getConnector(network);
  await c.disconnect();
}

/** Ask the wallet to sign and send one function call; returns the transaction hash. */
export async function callWithWallet(
  network: "testnet" | "mainnet",
  call: { receiverId: string; methodName: string; args: Record<string, unknown>; gasTgas: number; depositYocto: string },
): Promise<string> {
  const c = await getConnector(network);
  const wallet: NearWalletBase = await c.wallet();
  const outcome = (await wallet.signAndSendTransaction({
    receiverId: call.receiverId,
    actions: [{ type: "FunctionCall", params: { methodName: call.methodName, args: call.args, gas: (BigInt(call.gasTgas) * BigInt(10) ** BigInt(12)).toString(), deposit: call.depositYocto } }],
  })) as unknown as { transaction_outcome?: { id?: string }; transaction?: { hash?: string }; status?: Record<string, unknown> };
  const hash = outcome.transaction_outcome?.id ?? outcome.transaction?.hash;
  if (outcome.status && "Failure" in outcome.status) throw new Error(`The transaction failed: ${JSON.stringify(outcome.status.Failure).slice(0, 300)}`);
  if (!hash) throw new Error("The wallet did not return a transaction hash.");
  return hash;
}

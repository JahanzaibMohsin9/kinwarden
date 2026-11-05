/**
 * Read-only NEAR contract views over JSON-RPC, for the browser: the approval screen reads the
 * proposal straight from the chain instead of trusting the app server's copy.
 */
export async function nearView<T>(rpcUrl: string, contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const argsBase64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args))));
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "kinwarden",
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: contractId, method_name: method, args_base64: argsBase64 },
    }),
  });
  const body = (await res.json()) as { result?: { result?: number[]; error?: string }; error?: { data?: unknown; message?: string } };
  if (body.error || body.result?.error) throw new Error(`NEAR view ${method} failed: ${JSON.stringify(body.error ?? body.result?.error)}`);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result!.result!))) as T;
}

/** tUSDC base units as a readable amount, e.g. "7,142.86". */
export function tusdc(units: string | bigint, decimals = 6): string {
  const n = BigInt(units);
  const base = BigInt(10) ** BigInt(decimals);
  const whole = n / base;
  const cents = ((n % base) * BigInt(100)) / base;
  return `${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

/** An account's spendable NEAR balance in yoctoNEAR, or null if the account does not exist. */
export async function nearBalance(rpcUrl: string, accountId: string): Promise<bigint | null> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "kinwarden", method: "query", params: { request_type: "view_account", finality: "final", account_id: accountId } }),
  });
  const body = (await res.json()) as { result?: { amount?: string }; error?: unknown };
  return body.result?.amount ? BigInt(body.result.amount) : null;
}

/** yoctoNEAR as NEAR with three decimals, e.g. "0.250". */
export function nearAmount(yocto: bigint): string {
  const milli = yocto / BigInt(10) ** BigInt(21);
  return `${milli / BigInt(1000)}.${(milli % BigInt(1000)).toString().padStart(3, "0")}`;
}

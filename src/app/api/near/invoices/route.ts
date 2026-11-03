import { runtime } from "@/server/runtime";
import { sessionId } from "@/server/session";
import { tusdcUnits } from "@/server/near/bridge";

/**
 * Feed for the verifier operator (scripts/near/verifier.mjs): open invoices of linked cases from
 * enrolled institutions, with the on-chain id and tUSDC ceiling to authorize. The verifier decides
 * whether to authorize; the app never holds the verifier's key.
 */
export async function GET(request: Request) {
  const { store, near } = runtime(sessionId(request));
  if (!near) return Response.json({ error: "NEAR is not configured." }, { status: 404 });
  const d = near.deployment;
  const invoices = Object.values(store.world.invoices)
    .filter((inv) => inv.status === "open" && d.cases[inv.caseId] && d.payees[inv.institutionId])
    .map((inv) => ({
      vaultInvoiceId: near.vaultInvoiceId(inv.number),
      vaultCaseId: d.cases[inv.caseId].vaultCaseId,
      payeeId: d.payees[inv.institutionId].payeeId,
      ceilingUnits: tusdcUnits(inv.amountDue, inv.currency, inv.issuedAt),
      number: inv.number,
      institution: store.world.institutions[inv.institutionId].name,
      amountDue: inv.amountDue,
      currency: inv.currency,
      issuedAt: inv.issuedAt,
    }));
  return Response.json({ network: d.network, vault: d.vault, invoices });
}

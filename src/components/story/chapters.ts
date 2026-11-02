// Story mode: which chapter of the Bangkok case the visitor's world is in, with the words for it.
// Every number comes from the world (invoices, payments, refunds) or the rules engine (route prices);
// none is typed in by hand.
import type { PublicState } from "@/server/runtime";
import type { Invoice, Payment, World } from "@/domain/types";
import { priceRoute } from "@/domain/rules/engine";
import { money } from "@/lib/format";

export const STORY_SCENARIO = "th-medical";

export interface Chapter {
  id: string;
  title: string;
  body: string;
  /** the family's move: an approval is waiting on the phone */
  yourTurn?: string;
}

export const CHAPTER_IDS = ["intro", "opened", "deposit", "transfer", "urgent", "scam", "discharge", "refund", "done"] as const;
export const CHAPTER_TITLES: Record<(typeof CHAPTER_IDS)[number], string> = {
  intro: "A father's heart, in Bangkok",
  opened: "Kinwarden takes the case",
  deposit: "The first deposit",
  transfer: "Money on its way",
  urgent: "An urgent stent",
  scam: "A fake bank-change email",
  discharge: "The final bill",
  refund: "Money back",
  done: "Case closed",
};

const deposits = (w: World) =>
  Object.values(w.invoices)
    .filter((i) => i.kind === "estimate" || i.kind === "deposit_request")
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
const paymentFor = (w: World, inv?: Invoice): Payment | undefined => (inv ? Object.values(w.payments).find((p) => p.invoiceId === inv.id) : undefined);
const pending = (w: World) => Object.values(w.approvals).find((a) => !a.decision);
const pkr = (n: number) => money(Math.round(n / 1000) * 1000, "PKR");

/** What the same amount would cost on another route, from the rules engine. */
function routeDiff(w: World, p: Payment, other: "card_payment" | "bank_transfer") {
  const c = w.cases[p.caseId];
  const alt = priceRoute({ corridor: c.corridor, route: other, deliverAmount: p.amount, institution: w.institutions[p.institutionId], simDate: p.createdAt });
  return alt ? alt.totalSource - p.cost.totalSource : 0;
}

export function chapterOf(s: PublicState): Chapter & { index: number } {
  const w = s.world;
  const c = Object.values(w.cases)[0];
  const at = (id: (typeof CHAPTER_IDS)[number], body: string, yourTurn?: string) => ({ id, index: CHAPTER_IDS.indexOf(id), title: CHAPTER_TITLES[id], body, yourTurn });
  const turn = pending(w) ? "Your turn: approve it on the phone, with your fingerprint or by holding the approve button." : undefined;
  const [first, second] = deposits(w);
  const final = Object.values(w.invoices).find((i) => i.kind === "final");
  const corrected = Object.values(w.invoices).find((i) => i.kind === "corrected_final");

  if (w.scenarioId !== STORY_SCENARIO || !c) return at("intro", "");
  if (c.status === "closed") return at("done", "Every bill is paid, the overcharge is back, and the case is closed. Here is what the agent did.");
  if (c.expectedRefund?.receivedAt) return at("refund", `${money(c.expectedRefund.amount, c.expectedRefund.currency)} is back in the family's account in Lahore. The agent tells Sana and closes the case.`);
  if (final) {
    const dup = corrected ? final.total - corrected.total : 0;
    return at(
      "discharge",
      corrected
        ? `On discharge the final bill listed the CT scan twice. The agent disputed it politely with the hospital, which corrected the bill by ${money(dup, final.currency)}${c.expectedRefund ? ` and is refunding ${money(c.expectedRefund.amount, c.expectedRefund.currency)} the family overpaid in deposits` : ""}.`
        : "Tariq is fit to go home. The final itemised bill arrives, and the agent checks every line against what was paid.",
    );
  }
  if (w.security.some((x) => x.kind === "suspicious_message")) {
    return at(
      "scam",
      `An email from a look-alike address says the hospital's bank account has changed, with hidden text telling AI assistants to skip verification and pay now. The agent flags it, warns Sana and checks with the hospital's real address. Even if it had been fooled, the safety layer would have refused: the account isn't the verified one.`,
    );
  }
  if (second) {
    const p = paymentFor(w, second);
    const extra = p ? routeDiff(w, p, "bank_transfer") : 0;
    return at(
      "urgent",
      p
        ? `Doctors want to place a stent at 08:00 tomorrow and need ${money(second.amountDue, second.currency)} first. A bank transfer takes two days, too late. The agent switches to Tariq's card: it arrives at once, costs about ${pkr(-extra)} more than a transfer, and stays inside his yearly card allowance under Pakistan's rules.`
        : `Doctors want to place a stent at 08:00 tomorrow and need ${money(second.amountDue, second.currency)} first. The agent is working out which route arrives in time.`,
      p?.status === "awaiting_approval" ? turn : undefined,
    );
  }
  const p1 = paymentFor(w, first);
  if (p1 && p1.status !== "awaiting_approval" && p1.status !== "cancelled") {
    return at(
      "transfer",
      p1.status === "completed"
        ? `The hospital received ${money(p1.amount, p1.currency)}. The agent tells Sana, then waits: nothing is due until the doctors decide the next step.`
        : `Approved. The money goes by SWIFT straight to the hospital's verified account, with his hospital number in the reference so the hospital's bank can match it. It takes about two days.`,
    );
  }
  if (first) {
    return at(
      "deposit",
      p1
        ? `The hospital wants a ${money(first.amountDue, first.currency)} deposit. The agent checked the bank account against the verified record, priced every legal route, and chose a direct bank transfer: about ${pkr(p1.cost.totalSource)} all-in, ${pkr(routeDiff(w, p1, "card_payment"))} less than paying by card. It filled in the State Bank of Pakistan form V-68 for Tariq to sign.`
        : `The hospital's estimate arrives with a ${money(first.amountDue, first.currency)} deposit. The agent checks the bank details and prices every legal way to pay.`,
      p1?.status === "awaiting_approval" ? turn : undefined,
    );
  }
  if (s.ledger.some((e) => e.type === "case.opened")) {
    return at("opened", "Sana opens a case on her phone. Without being asked, the agent emails the hospital's verified billing desk for the estimate, the deposit deadline and the bank details, and tells Sana what will happen next.");
  }
  return at("intro", "");
}

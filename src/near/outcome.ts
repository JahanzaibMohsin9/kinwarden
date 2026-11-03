// What a NEAR payment's state means for the family: whether delivery is confirmed, where the reserved
// money is, and what they can do next. Shared by the case receipt and the app's screens, so both say
// the same thing. Delivery follows the vault's own record: a submitted transaction or an approval
// alone never counts as delivered, and an unknown outcome is never shown as failed or refunded.
import type { NearPaymentLink } from "@/domain/types";

export type Delivery = "awaiting_approval" | "not_sent" | "unknown" | "delivered" | "failed";

export interface Outcome {
  delivery: Delivery;
  /** short label for badges */
  label: string;
  /** where the case's money for this payment is now */
  funds: string;
  /** what the family can do next */
  next: string;
}

export function nearOutcome(state: NearPaymentLink["state"]): Outcome {
  switch (state) {
    case "proposing":
    case "waiting_for_verifier":
      return {
        delivery: "awaiting_approval",
        label: "Not proposed yet",
        funds: "Nothing is reserved yet; the case balance is unchanged.",
        next: "Wait for the verifier to authorize the invoice. You approve only after the vault shows the proposal.",
      };
    case "PendingApproval":
      return {
        delivery: "awaiting_approval",
        label: "Waiting for your approval",
        funds: "Reserved in the vault for this payment. Nothing has moved.",
        next: "Approve or reject it in your NEAR wallet before it expires.",
      };
    case "Submitted":
      return {
        delivery: "unknown",
        label: "Outcome unknown",
        funds: "Held in flight by the vault: not spendable, not refunded and not resent.",
        next: "Wait for the vault to record the transfer's result and check the approval transaction on the explorer. Do not pay this bill another way while the outcome is unknown.",
      };
    case "Settled":
      return {
        delivery: "delivered",
        label: "Delivered",
        funds: "Paid from the case to the institution's account.",
        next: "Nothing. A NEAR transfer cannot be reversed; any refund would be a new transfer from the institution.",
      };
    case "Failed":
      return {
        delivery: "failed",
        label: "Transfer failed",
        funds: "The tokens never left the vault: the amount is back in the case's available balance and its 24-hour budget is released.",
        next: "Ask the agent to propose the payment again. It needs a new approval in your wallet.",
      };
    case "Rejected":
      return {
        delivery: "not_sent",
        label: "Rejected by you",
        funds: "Released back to the case. Nothing was sent.",
        next: "Nothing. Paying this bill again needs a new proposal and a new approval.",
      };
    case "Expired":
      return {
        delivery: "not_sent",
        label: "Expired",
        funds: "Released back to the case. Nothing was sent.",
        next: "If the bill is still due, ask the agent to propose it again.",
      };
    case "Invalidated":
      return {
        delivery: "not_sent",
        label: "Cancelled by the vault",
        funds: "Released back to the case. Nothing was sent.",
        next: "A pause, a limit change or a revocation cancelled it. Check the reason; the agent must propose again.",
      };
    case "error":
      return {
        delivery: "not_sent",
        label: "Refused by the vault",
        funds: "Nothing was reserved; the case balance is unchanged.",
        next: "The vault's rules refused this payment. See the reason; the bill stays open.",
      };
  }
}

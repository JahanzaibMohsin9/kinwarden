import { describe, expect, it } from "vitest";
import type { NearPaymentLink } from "@/domain/types";
import { nearOutcome } from "./outcome";

const STATES: NearPaymentLink["state"][] = ["proposing", "waiting_for_verifier", "PendingApproval", "Submitted", "Settled", "Failed", "Rejected", "Expired", "Invalidated", "error"];

describe("NEAR payment outcomes for the family", () => {
  it("only the vault's settled record counts as delivered", () => {
    expect(STATES.filter((s) => nearOutcome(s).delivery === "delivered")).toEqual(["Settled"]);
  });

  it("a submitted payment is unknown: held in flight, neither failed nor refunded", () => {
    const o = nearOutcome("Submitted");
    expect(o.delivery).toBe("unknown");
    expect(o.funds).toMatch(/in flight/);
    expect(o.funds).toMatch(/not refunded and not resent/);
    expect(o.next).toMatch(/Do not pay this bill another way/);
  });

  it("a failed transfer returns the money to the case and needs a new approval", () => {
    const o = nearOutcome("Failed");
    expect(o.delivery).toBe("failed");
    expect(o.funds).toMatch(/never left the vault/);
    expect(o.next).toMatch(/new approval/);
  });

  it("a delivered payment does not promise a refund", () => {
    expect(nearOutcome("Settled").next).toMatch(/cannot be reversed/);
  });

  it("every state says where the money is and what to do next", () => {
    for (const s of STATES) {
      const o = nearOutcome(s);
      expect(o.funds.length, s).toBeGreaterThan(10);
      expect(o.next.length, s).toBeGreaterThan(5);
    }
  });
});

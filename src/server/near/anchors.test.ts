import { describe, expect, it } from "vitest";
import { anchoredEvent, anchorLabel } from "./anchors";
import type { FinalTx } from "./bridge";

const VAULT = "vault.demo.testnet";
const event = (data: Record<string, unknown>, standard = "kinwarden") => `EVENT_JSON:${JSON.stringify({ standard, version: "1.0.0", event: "log_anchored", data: [data] })}`;
const tx = (executor: string, logs: string[]): FinalTx => ({
  status: { SuccessValue: "" },
  transaction: { signer_id: "agent.demo.testnet", receiver_id: VAULT, actions: [] },
  receipts_outcome: [{ id: "R1", block_hash: "B1", outcome: { executor_id: executor, logs, status: { SuccessValue: "" } } }],
});
const HEAD = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

describe("NEAR log anchors", () => {
  it("reads the vault's log_anchored event", () => {
    const data = { case_id: "case-th", index: "0", seq: "12", head: HEAD, label: "a1b2c3:th-medical:payment approved" };
    expect(anchoredEvent(tx(VAULT, ["something else", event(data)]), VAULT)).toEqual(data);
  });

  it("ignores events from other contracts or other standards", () => {
    const data = { case_id: "case-th", index: "0", seq: "12", head: HEAD, label: "x" };
    expect(anchoredEvent(tx("attacker.testnet", [event(data)]), VAULT)).toBeNull();
    expect(anchoredEvent(tx(VAULT, [event(data, "nep141")]), VAULT)).toBeNull();
  });

  it("labels start with the run tag and stay within the vault's rules", () => {
    expect(anchorLabel("a1b2c3", "th-medical:case opened")).toBe("a1b2c3:th-medical:case opened");
    expect(anchorLabel("a1b2c3", "uk-tuition:雨萱")).toBe("a1b2c3:uk-tuition:??");
    expect(anchorLabel("a1b2c3", "x".repeat(200))).toHaveLength(96);
  });
});

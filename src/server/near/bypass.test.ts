import { describe, expect, it } from "vitest";
import {
  AccessKeyDepositWithFunctionCallActionError,
  AccessKeyMethodNameMismatchActionError,
  AccessKeyReceiverMismatchActionError,
  AccessKeyRequiresFullAccessActionError,
} from "near-api-js/rpc-errors";
import { classify } from "./bypass";

// A production (minified) build renames these classes, and near-api-js keeps only a free-text message
// such as "Access key does not allow method withdraw", so the refusal must be read from the class.
describe("classify: who refused a stolen-key attempt", () => {
  it("names each key-permission refusal from the error's class, not its text", () => {
    const cases: [Error, string][] = [
      [new AccessKeyMethodNameMismatchActionError("withdraw", 0, "", ""), "MethodNameMismatch"],
      [new AccessKeyDepositWithFunctionCallActionError(0, "", ""), "DepositWithFunctionCall"],
      [new AccessKeyReceiverMismatchActionError("vault.test", "tusdc.test", 0, "", ""), "ReceiverMismatch"],
      [new AccessKeyRequiresFullAccessActionError(0, "", ""), "RequiresFullAccess"],
    ];
    for (const [err, reason] of cases) {
      Object.defineProperty(err, "name", { value: "a_" }); // as a minifier leaves it
      expect(classify(err)).toEqual({ refusedBy: "protocol", reason });
    }
  });

  it("reads the vault's refusal code from a contract panic", () => {
    const err = new Error("Smart contract panicked: E_CAP_PAYMENT");
    expect(classify(err)).toMatchObject({ refusedBy: "contract", reason: "E_CAP_PAYMENT" });
  });

  it("marks anything else unclassified, which fails the run", () => {
    expect(classify(new Error("socket hang up")).reason).toMatch(/^UNCLASSIFIED/);
  });
});

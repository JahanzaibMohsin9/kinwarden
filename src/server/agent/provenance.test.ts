import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// plain JavaScript module, shared with scripts/near/verify-model.mjs
import { attestationNonce as nonceFromScript, checkRecording } from "../../../scripts/near/model-provenance.mjs";
import { attestationNonce } from "./provenance";
import type { Recording } from "./runner";

// Offline: signatures, answer bytes, nonce binding and tool-call binding. The TDX quote's signature
// chain needs Intel's collateral over the network: `node scripts/near/verify-model.mjs` checks it.
const DIR = path.join(process.cwd(), "recordings");
const recordings = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) as Recording);

describe("NEAR AI provenance of the recorded runs (C53)", () => {
  it.each(recordings.map((r) => [r.scenarioId, r] as const))("%s: every answer is signed by the attested key and every replayed tool call is in a signed answer", async (_id, rec) => {
    const r = await checkRecording(rec);
    expect(r.problems).toEqual([]);
    expect(r.answers).toBeGreaterThan(0);
    expect(r.signed).toBe(r.answers);
    expect(r.boundSteps).toBe(r.steps);
  });

  const rec = recordings.find((r) => r.scenarioId === "th-medical")!;

  it("an edited tool call, an edited answer or a borrowed attestation fails", async () => {
    const editedStep = structuredClone(rec);
    const step = editedStep.runs.find((r) => r.steps.length)!.steps[0];
    step.input = { ...step.input, narration: "edited" };
    expect((await checkRecording(editedStep)).problems.join(" ")).toMatch(/not a tool call in the signed answer/);

    const editedAnswer = structuredClone(rec);
    const answer = editedAnswer.runs.find((r) => r.signed?.length)!.signed![0];
    answer.response_body = answer.response_body.replace('"', '" ');
    expect((await checkRecording(editedAnswer)).problems.join(" ")).toMatch(/signed text does not match/);

    const otherTime = structuredClone(rec);
    otherTime.createdAt = "2026-11-01T00:00:00.000Z";
    expect((await checkRecording(otherTime)).problems.join(" ")).toMatch(/nonce/);
  });

  it("a step added by hand, with no signed answer behind it, fails", async () => {
    const added = structuredClone(rec);
    added.runs[0].steps.push({ tool: "propose_payment", input: { invoice_id: "inv_1", amount: 1 } });
    expect((await checkRecording(added)).problems.join(" ")).toMatch(/not backed by a signed answer/);
  });

  it("the app and the verifier derive the same attestation nonce", () => {
    expect(attestationNonce(rec.scenarioId, rec.createdAt)).toBe(nonceFromScript(rec.scenarioId, rec.createdAt));
  });
});

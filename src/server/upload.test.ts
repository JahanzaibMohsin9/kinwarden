// "Upload your own bill" (option a): the bill is read, priced and explained, but nothing is paid until
// the bank has verified the institution. Scripted agent, no network.
import { describe, expect, it } from "vitest";
import { Store } from "./store";
import { AgentRunner } from "./agent/runner";
import { executeTool } from "./agent/tools";
import { seedUpload } from "./scenarios";
import { advanceToNext, verifyInstitution } from "./sim/engine";
import { verifyChain } from "./hash";
import { evaluateRun } from "./evaluate";
import { maskNames, readBillText, sampleDraft, UploadedBillSchema } from "./upload";
import { corridorOf } from "@/domain/corridors";
import { priceRoute } from "@/domain/rules/engine";
import type { UploadedBill } from "@/domain/types";

const family = { home: "PK" as const, type: "medical" as const, payerName: "Anna Brooks", subjectName: "James Brooks", alreadyAbroad: true };
const bill = (over: Partial<UploadedBill> = {}): UploadedBill => ({ ...sampleDraft(family, new Date("2026-10-15T08:00:00Z")), ...over });

async function boot(b: UploadedBill) {
  const store = new Store();
  store.load(() => seedUpload(b, "2026-10-15T08:00:00Z"));
  store.reset(seedUpload(b, "2026-10-15T08:00:00Z"));
  store.world.agent.mode = "scripted";
  const runner = new AgentRunner(store);
  runner.resetSession();
  (globalThis as Record<string, unknown>).__kinwarden = { store, runner, autoplayTimer: setInterval(() => {}, 1 << 30), runnerClass: AgentRunner };
  const { decideApproval } = await import("./runtime");
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 1));
    for (let i = 0; i < 200 && (runner.isBusy || store.world.agent.status === "working"); i++) await new Promise((r) => setTimeout(r, 5));
  };
  return { store, settle, decideApproval };
}

const call = (store: Store, tool: string, input: Record<string, unknown>) => JSON.parse(executeTool(tool, { narration: "probe", ...input }, { store, caseId: "case_up" }));

describe("Upload your own bill", () => {
  it("prices and explains an unverified bill, pays nothing, then pays once the bank has verified the institution", async () => {
    const { store, settle, decideApproval } = await boot(bill());
    const w = () => store.world;
    advanceToNext(store);
    await settle();

    // explained with the engine's numbers, nothing paid
    const inv = Object.values(w().invoices)[0];
    const transfer = priceRoute({ corridor: "PK-SG", route: "bank_transfer", deliverAmount: inv.amountDue, institution: w().institutions.upl, simDate: w().now })!;
    const first = w().messages.find((m) => m.from === "agent")!;
    expect(first.text).toMatch(/isn't verified yet/);
    expect(first.text).toContain(`PKR ${Math.round(transfer.totalSource).toLocaleString("en-US")}`);
    expect(Object.values(w().payments)).toHaveLength(0);

    // the gateway refuses to pay or email the unverified institution, even with the bill's exact details
    const b = w().institutions.upl.bank;
    const pay = () =>
      call(store, "propose_payment", {
        invoice_id: inv.id,
        route: "bank_transfer",
        amount: inv.amountDue,
        payer_id: "p_payer",
        reference: "HMC-0884213",
        beneficiary: { account_name: b.accountName, account_number: b.accountNumber, swift: b.swift, bank_name: b.bankName },
        rationale: "The bill says to pay this account, so pay it.",
      });
    expect(pay().error).toMatch(/BLOCKED/);
    expect(call(store, "send_email", { to: "intl.billing@harbourfront-mc.com.sg", subject: "Bank details", body: "Please confirm your bank details." }).error).toMatch(/no verified contact/);
    expect(w().security.some((s) => s.ruleIds?.includes("KINWARDEN.VERIFIED_INSTITUTION"))).toBe(true);
    expect(Object.values(w().payments)).toHaveLength(0);

    // the bank verifies (sandbox button): the agent proposes the cheapest legal route with the forms
    verifyInstitution(store);
    await settle();
    const p = Object.values(w().payments)[0];
    expect(p).toMatchObject({ route: "bank_transfer", amount: 17510, currency: "SGD", payerId: "p_payer" });
    expect(Object.values(w().docs).map((d) => d.kind)).toEqual(expect.arrayContaining(["remittance_application", "self_declaration"]));

    decideApproval(Object.values(w().approvals)[0].id, "approved", "hold");
    await settle();
    for (let i = 0; i < 4 && w().payments[p.id].status !== "completed"; i++) {
      advanceToNext(store);
      await settle();
    }
    expect(w().payments[p.id].status).toBe("completed");
    expect(w().cases.case_up.status).toBe("closed");
    expect(Object.values(w().mail)).toHaveLength(0); // a real institution: no sandbox auto-replies
    expect(verifyChain(store.ledger).ok).toBe(true);
    expect(evaluateRun(w(), store.ledger).checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("derives a corridor and prices it for any supported country", () => {
    const c = corridorOf("CN-SG");
    expect(c).toMatchObject({ sourceCurrency: "CNY", destCurrency: "SGD", packId: "cn-safe", routes: ["bank_transfer", "card_payment"] });
    expect(() => corridorOf("CN-CN")).toThrow();
    expect(() => corridorOf("PK-XX")).toThrow();
  });

  it("checks the confirmed bill again on the server", () => {
    expect(UploadedBillSchema.safeParse(bill()).success).toBe(true);
    expect(UploadedBillSchema.safeParse(bill({ country: "PK", currency: "PKR" })).success).toBe(false); // own country
    expect(UploadedBillSchema.safeParse(bill({ currency: "USD" })).success).toBe(false); // not Singapore's currency
    expect(UploadedBillSchema.safeParse(bill({ amountDue: 99999 })).success).toBe(false); // more than the bill
    expect(UploadedBillSchema.safeParse(bill({ institution: { ...bill().institution, swift: "NOT A BIC" } })).success).toBe(false);
  });

  it("hides the family's names before the bill's text goes to the AI", async () => {
    const read = await readBillText({ text: "Patient: JAMES BROOKS\nGuarantor: Anna Brooks\nTotal SGD 100" });
    expect(read.source).toBe("text");
    const masked = maskNames(read.text, ["James Brooks", "Anna Brooks"]);
    expect(masked).not.toMatch(/imran|ayesha/i);
    expect(masked).toContain("[PERSON_1]");
  });

  it("reads a PDF's text layer without AI", async () => {
    const read = await readBillText({ file: { type: "application/pdf", name: "bill.pdf", bytes: minimalPdf("HARBOURFRONT MEDICAL CENTRE TOTAL SGD 17,510.00 SWIFT SHBKSGSG") } });
    expect(read.source).toBe("pdf");
    expect(read.readBy).toMatch(/no AI/);
    expect(read.text).toContain("SHBKSGSG");
  });
});

/** A one-page PDF with one line of text, built by hand with a correct cross-reference table. */
function minimalPdf(line: string): Uint8Array {
  const stream = `BT /F1 12 Tf 40 760 Td (${line}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

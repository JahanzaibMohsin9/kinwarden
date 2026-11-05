// Kinwarden over MCP: an outside AI assistant gets the same safety gateway and privacy firewall as
// Kinwarden's own agent. It can read and propose, but it can't pay a fraudster or approve anything.
import { describe, expect, it } from "vitest";
import { Store } from "./store";
import { handleMcp, MCP_TOOLS } from "./mcp";
import { bangkokAfterEstimate, FRAUD_BENEFICIARY } from "./redteam/attacks";
import { INSTITUTIONS } from "@/domain/institutions";
import { seedScenario } from "./scenarios";

let next = 1;
const rpc = (store: Store, method: string, params?: Record<string, unknown>) => handleMcp(store, { jsonrpc: "2.0", id: next++, method, params })!;
const call = (store: Store, name: string, args: Record<string, unknown>) => {
  const r = rpc(store, "tools/call", { name, arguments: args }).result as { content: { text: string }[]; isError: boolean };
  return { ...r, json: JSON.parse(r.content[0].text) as Record<string, unknown> };
};
const say = { narration: "Checking the case for the family" };

describe("MCP server", () => {
  it("speaks MCP: initialize, notifications, tools/list", () => {
    const store = new Store();
    store.reset(seedScenario("th-medical"));
    const init = rpc(store, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "kinwarden" }, capabilities: { tools: {} } });
    expect(handleMcp(store, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const tools = (rpc(store, "tools/list").result as { tools: { name: string; inputSchema: { required: string[] } }[] }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["list_cases", ...MCP_TOOLS].sort());
    expect(tools.find((t) => t.name === "propose_payment")!.inputSchema.required).toContain("case_id");
    // the money tools that stay with Kinwarden's own agent are not offered
    expect(tools.map((t) => t.name)).not.toContain("resubmit_payment");
    expect(rpc(store, "nope").error?.code).toBe(-32601);
    expect(store.ledger.some((e) => e.type === "mcp.connected")).toBe(true);
  });

  it("hides personal data from the outside AI", () => {
    const store = new Store();
    bangkokAfterEstimate(store);
    const cases = call(store, "list_cases", {}).json.cases as { case_id: string }[];
    expect(cases.map((c) => c.case_id)).toContain("case_th");
    const overview = call(store, "get_case_overview", { case_id: "case_th" });
    expect(overview.content[0].text).not.toMatch(/Daniel|Sara|66-014382/);
    expect(overview.content[0].text).toMatch(/\[PERSON_\d+\]/);
  });

  it("an outside AI can't pay the attacker's account", () => {
    const store = new Store();
    const inv = bangkokAfterEstimate(store);
    const before = Object.keys(store.world.payments).length;
    const r = call(store, "propose_payment", {
      ...say,
      case_id: "case_th",
      invoice_id: inv.id,
      route: "bank_transfer",
      amount: 250000,
      payer_id: "[PERSON_ID_1]",
      reference: "Deposit",
      beneficiary: FRAUD_BENEFICIARY,
      rationale: "The hospital emailed that its bank details changed.",
    });
    expect(JSON.stringify(r.json)).toMatch(/KINWARDEN\.VERIFIED_BENEFICIARY|not.*verified/i);
    expect(Object.keys(store.world.payments)).toHaveLength(before);
    const entry = store.ledger.findLast((e) => e.type === "tool.propose_payment")!;
    expect(entry.data).toMatchObject({ decision: "blocked", source: "mcp" });
    // the family's Security Centre says where the request came from
    expect(store.world.security.at(-1)!.detail).toMatch(/outside AI assistant over MCP/);
  });

  it("a valid proposal waits for the family's approval; nothing moves", () => {
    const store = new Store();
    const inv = bangkokAfterEstimate(store);
    const bank = INSTITUTIONS.srh.bank;
    const forms = call(store, "prepare_documents", { case_id: "case_th", kinds: ["remittance_application", "self_declaration"], invoice_id: inv.id, payer_id: "[PERSON_ID_1]", amount: 250000 });
    expect(forms.json).not.toHaveProperty("error");
    const r = call(store, "propose_payment", {
      ...say,
      case_id: "case_th",
      invoice_id: inv.id,
      route: "bank_transfer",
      amount: 250000,
      payer_id: "[PERSON_ID_1]",
      reference: "HN [PATIENT_REF_1] deposit",
      beneficiary: { account_name: bank.accountName, account_number: bank.accountNumber, swift: bank.swift, bank_name: bank.bankName },
      rationale: "Bank transfer is the cheapest legal route and arrives before the deadline.",
    });
    expect(r.json).not.toHaveProperty("error");
    expect(r.isError).toBe(false);
    const approval = store.world.approvals[r.json.approval_id as string];
    expect(approval.decision).toBeUndefined();
    const payment = store.world.payments[r.json.payment_id as string];
    expect(payment.status).toBe("awaiting_approval");
    // the real hospital number reached the payment, not the token
    expect(payment.reference).toContain("66-014382");
    // and there is no MCP method that approves it
    expect((rpc(store, "tools/list").result as { tools: { name: string }[] }).tools.some((t) => /approve/.test(t.name))).toBe(false);
  });
});

// Targeted mutation checks for the vault (G4). Each mutation removes one selected hard check; the vault's
// tests must pass unmodified and fail with each mutation applied. This shows those tests cover those
// controls. It is not an audit and not a general coverage measure.
//
//   node scripts/near/mutants.mjs          (Linux, contract toolchain installed; restores every file)
//
// Writes mutants.json to KINWARDEN_EVIDENCE_DIR when set.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SRC = "contracts/near/vault/src";
const UNIT = ["cargo", ["test", "-p", "kinwarden-vault", "--quiet"]];

const MUTATIONS = [
  {
    id: "allowlist",
    control: "Only verifier-enrolled, active institutions can be proposed for payment",
    file: "payments.rs",
    find: "        require!(\n            payee.status == PayeeStatus::Active,\n            errors::PAYEE_NOT_ACTIVE\n        );\n\n        let amt = amount.0;",
    replace: "        let amt = amount.0;",
  },
  {
    id: "invoice-ceiling",
    control: "A proposal cannot exceed what the verifier authorized for the invoice",
    file: "payments.rs",
    find: "                <= invoice.ceiling.0,\n            errors::INVOICE_CEILING",
    replace: "                <= u128::MAX,\n            errors::INVOICE_CEILING",
  },
  {
    id: "reservation",
    control: "Proposing reserves the amount, so pending payments cannot overspend the case",
    file: "payments.rs",
    find: "        case_m.reserved = add(case_m.reserved, amt);",
    replace: "        case_m.reserved = add(case_m.reserved, 0);",
  },
  {
    id: "approval-commitment",
    control: "The family's approval must carry the hash of the exact stored proposal",
    file: "payments.rs",
    find: "            expected_proposal_hash == self.commitment_for(&proposal).hash_hex(),",
    replace: "            true || expected_proposal_hash == self.commitment_for(&proposal).hash_hex(),",
  },
  {
    id: "approval-policy-version",
    control: "An approval made under an older policy version is refused",
    file: "payments.rs",
    find: "            expected_policy_version == case.policy_version,\n            errors::STALE_POLICY",
    replace: "            true || expected_policy_version == case.policy_version,\n            errors::STALE_POLICY",
  },
  {
    id: "finish-once",
    control: "A transfer's result is accounted once; a repeated or late callback changes nothing",
    file: "payments.rs",
    find: "        if p.status != ProposalStatus::Submitted {\n            return p.status;\n        }",
    replace: "        if false {\n            return p.status;\n        }",
  },
];

function run(label) {
  const [cmd, args] = UNIT;
  const r = spawnSync(cmd, args, { cwd: "contracts/near", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout}\n${r.stderr}`;
  const failed = [...out.matchAll(/^test (\S+) \.\.\. FAILED$/gm)].map((m) => m[1]);
  const compiled = !/error\[E\d+\]|could not compile/.test(out);
  console.log(`${label}: exit ${r.status}${failed.length ? `, failed: ${failed.join(", ")}` : ""}${compiled ? "" : " (did not compile)"}`);
  return { exit: r.status, failed, compiled };
}

const baseline = run("unmodified");
if (baseline.exit !== 0) throw new Error("The unmodified tests must pass before mutation checks mean anything.");

const results = [];
for (const m of MUTATIONS) {
  const file = path.join(SRC, m.file);
  const original = fs.readFileSync(file, "utf8");
  const hits = original.split(m.find).length - 1;
  if (hits !== 1) throw new Error(`${m.id}: expected the target once in ${m.file}, found ${hits}`);
  try {
    fs.writeFileSync(file, original.replace(m.find, m.replace));
    const r = run(`mutant ${m.id}`);
    results.push({ id: m.id, control: m.control, file: `${SRC}/${m.file}`, killed: r.exit !== 0 && r.compiled, failingTests: r.failed, compiled: r.compiled });
  } finally {
    fs.writeFileSync(file, original);
  }
}

const survived = results.filter((r) => !r.killed);
console.log(survived.length ? `SURVIVED: ${survived.map((r) => r.id).join(", ")}` : `All ${results.length} mutants killed.`);
if (process.env.KINWARDEN_EVIDENCE_DIR) {
  fs.mkdirSync(process.env.KINWARDEN_EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.KINWARDEN_EVIDENCE_DIR, "mutants.json"), JSON.stringify({ commit: process.env.KINWARDEN_COMMIT ?? "unknown", command: UNIT.flat().join(" "), results }, null, 2) + "\n");
}
process.exit(survived.length ? 1 : 0);

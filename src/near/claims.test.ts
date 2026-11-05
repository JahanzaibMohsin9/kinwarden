import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeps docs/near/CLAIMS.md honest: every test it names in its "Tests" column must exist, so a
 * renamed or deleted test cannot leave a claim pointing at nothing. Rust names must be real
 * `#[test]` / `#[tokio::test]` functions (in the named module when written `module::name`, with `*`
 * as a wildcard); file names must exist; any other reference must appear in an app test file.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const CLAIMS = fs.readFileSync(path.join(ROOT, "docs/near/CLAIMS.md"), "utf8");

function walk(dir: string, keep: (file: string) => boolean): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "target" || e.name === "node_modules" ? [] : walk(full, keep);
    return keep(full) ? [full] : [];
  });
}

const rustFiles = walk(path.join(ROOT, "contracts/near"), (f) => f.endsWith(".rs"));
const RUST_TEST = /#\[(?:tokio::)?test[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:async\s+)?fn\s+(\w+)/g;
/** Test function names per Rust file stem (`g1`, `tests_payments`, `commitment`, ...). */
const rustTests = new Map<string, string[]>();
for (const file of rustFiles) {
  const names = [...fs.readFileSync(file, "utf8").matchAll(RUST_TEST)].map((m) => m[1]);
  const stem = path.basename(file, ".rs");
  rustTests.set(stem, [...(rustTests.get(stem) ?? []), ...names]);
}
const allRustTests = [...rustTests.values()].flat();

const allFiles = [
  ...walk(path.join(ROOT, "src"), () => true),
  ...walk(path.join(ROOT, "scripts"), () => true),
  ...rustFiles,
].map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
const appTestText = allFiles
  .filter((f) => f.endsWith(".test.ts") || f.endsWith(".sandbox.ts"))
  .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"))
  .join("\n");

const pattern = (glob: string) => new RegExp(`^${glob.replace(/\*/g, "\\w*")}$`);

/** Why a reference does not resolve, or null when it does. */
function unresolved(ref: string): string | null {
  if (/\.(ts|rs|mjs)$/.test(ref)) {
    return allFiles.some((f) => f === ref || f.endsWith(`/${ref}`)) ? null : "no such file";
  }
  const scoped = ref.match(/^(\w+)::([\w*]+)$/);
  if (scoped) {
    const names = rustTests.get(scoped[1]);
    if (!names) return `no Rust file ${scoped[1]}.rs`;
    return names.some((n) => pattern(scoped[2]).test(n)) ? null : `no matching test in ${scoped[1]}.rs`;
  }
  if (/^[\w*]+$/.test(ref) && allRustTests.some((n) => pattern(ref).test(n))) return null;
  return appTestText.includes(ref) ? null : "not a Rust test and not found in any app test";
}

const rows = CLAIMS.split("\n")
  .filter((line) => /^\| C\d+ \|/.test(line))
  .map((line) => {
    const cells = line.split("|").map((c) => c.trim());
    return { id: cells[1], tests: cells[4], refs: [...cells[4].matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
  });

describe("NEAR claim -> test map (docs/near/CLAIMS.md)", () => {
  it("numbers every claim once, from C1 without gaps", () => {
    const ids = rows.map((r) => Number(r.id.slice(1))).sort((a, b) => a - b);
    expect(ids.length).toBeGreaterThan(40);
    expect(ids).toEqual(ids.map((_, i) => i + 1));
  });

  it("names at least one test for every claim", () => {
    expect(rows.filter((r) => r.refs.length === 0 && !/\be2e\b/.test(r.tests)).map((r) => r.id)).toEqual([]);
  });

  it("names only tests and files that exist", () => {
    const missing = rows.flatMap((r) => r.refs.map((ref) => ({ claim: r.id, ref, why: unresolved(ref) }))).filter((m) => m.why);
    expect(missing).toEqual([]);
  });

  it("would notice a renamed test", () => {
    expect(unresolved("g2::honest_payment_settles_to_the_enrolled_hospital")).toBeNull();
    expect(unresolved("g2::honest_payment_settles_to_a_renamed_hospital")).not.toBeNull();
    expect(unresolved("approval_with_other_*_is_refused")).toBeNull();
    expect(unresolved("bridge.test.ts")).toBeNull();
    expect(unresolved("missing.sandbox.ts")).not.toBeNull();
  });
});

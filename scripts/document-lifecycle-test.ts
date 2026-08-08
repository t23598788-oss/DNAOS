/**
 * Document Lifecycle Constitution Regression Suite (owner, 2026-08-07,
 * Software Factory Step 10, Phase 8) — verifies the real, typed Document
 * Lifecycle Constitution. No real Document Lifecycle engine exists yet;
 * this suite proves every policy honestly reports its real status
 * (DECLARED_NOT_ENFORCED or NOT_IMPLEMENTED), never a fabricated ENFORCED.
 *
 * Run: npm run document-lifecycle:test
 */
import { readFileSync } from "fs";
import path from "path";
import { getDocumentLifecycleConstitution, DOCUMENT_LIFECYCLE_CONSTITUTION } from "../app/api/admin/ide/_lib/documentLifecycleConstitution";

const ROOT = path.join(__dirname, "..");
interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

const REQUIRED_POLICIES = ["classification", "retention", "evidence", "compression", "deduplication", "archive", "legalRetention", "recovery"] as const;

async function main() {
  await test("Document Lifecycle: all 8 real, required policies are declared (Classification/Retention/Evidence/Compression/Deduplication/Archive/LegalRetention/Recovery)", () => {
    const c = getDocumentLifecycleConstitution();
    for (const p of REQUIRED_POLICIES) assert(p in c, `expected a real policy for "${p}"`);
  });
  await test("Document Lifecycle: every real policy has a real, honest status — only DECLARED_NOT_ENFORCED or NOT_IMPLEMENTED, never ENFORCED (no real engine exists yet)", () => {
    const c = getDocumentLifecycleConstitution();
    for (const p of REQUIRED_POLICIES) {
      const status = c[p].status;
      assert(status === "DECLARED_NOT_ENFORCED" || status === "NOT_IMPLEMENTED", `policy "${p}" has an unexpected status "${status}" — must be honestly DECLARED_NOT_ENFORCED or NOT_IMPLEMENTED`);
    }
  });
  await test("Document Lifecycle: getDocumentLifecycleConstitution() is deterministic — the SAME real object structure every call", () => {
    const c1 = getDocumentLifecycleConstitution();
    const c2 = getDocumentLifecycleConstitution();
    assert(JSON.stringify(c1) === JSON.stringify(c2), "expected the same real Constitution on every call");
    assert(c1 === DOCUMENT_LIFECYCLE_CONSTITUTION, "expected the real, single shared Constitution object — never a fresh fabrication per call");
  });
  await test("Document Lifecycle: LegalRetention is honestly jurisdictionDependent:true — real dependency on the (not-yet-real) Country Package's Legal Package", () => {
    const c = getDocumentLifecycleConstitution();
    assert(c.legalRetention.jurisdictionDependent === true, "expected legalRetention.jurisdictionDependent to be real and true");
    assert(c.legalRetention.status === "NOT_IMPLEMENTED", "expected legalRetention to be honestly NOT_IMPLEMENTED — no real Country Package exists");
  });
  await test("Document Lifecycle: DocumentCapabilityContract requires a real capabilityId field, matching registry/capability-registry.json's real CapabilityId shape", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/documentLifecycleConstitution.ts"), "utf-8");
    assert(src.includes("interface DocumentCapabilityContract"), "expected a real DocumentCapabilityContract interface");
    assert(src.includes("capabilityId: string; // real CapabilityId from registry/capability-registry.json"), "expected the real capabilityId field to cite the real registry it must match");
  });
  await test("Document Lifecycle: this file never writes to disk, never processes a real document — pure real, static Constitution declarations only", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/documentLifecycleConstitution.ts"), "utf-8");
    assert(!src.includes("writeFileSync") && !src.includes("execFile") && !src.includes("compress(") && !src.includes("archive("), "documentLifecycleConstitution.ts must never write a file, spawn a process, or actually process a document — it is a Constitution, not an engine");
  });
  await test("Document Lifecycle: Evidence policy requires real evidenceKinds that are real EvidenceKind values from artifactRuntime.ts — never invented kinds", () => {
    const c = getDocumentLifecycleConstitution();
    const artifactSrc = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/artifactRuntime.ts"), "utf-8");
    for (const kind of c.evidence.evidenceKinds) {
      assert(artifactSrc.includes(`"${kind}"`), `evidence kind "${kind}" must be a real EvidenceKind value already defined in artifactRuntime.ts`);
    }
  });

  console.log("\n=== Document Lifecycle Constitution Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });

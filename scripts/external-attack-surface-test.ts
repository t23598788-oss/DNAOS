/**
 * External Attack Surface Discovery & Verification Regression Suite
 * (owner, 2026-08-08, Software Factory Step 13.7) — verifies: Domain
 * Asset registration/verification separation, the real Security
 * Execution Gate boundary, real passive-only Subfinder argv safety,
 * real non-invasive httpx argv safety, zero exploitation capability,
 * real Node dns.promises verification, and the real, deterministic
 * 4-layer External Drift classification engine (KNOWN/NEW/CHANGED/
 * DISAPPEARED/UNREGISTERED/UNREACHABLE).
 *
 * Run: npm run external-attack-surface:test
 */
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { registerDomainAsset, verifyDomainAsset, getDomainAsset, listDomainAssets, DomainAssetError } from "../app/api/admin/ide/_lib/domainAssetRuntime";
import { runExternalDiscovery, computeExternalDrift, ExternalAttackSurfaceError, type HostDriftEntry } from "../app/api/admin/ide/_lib/externalAttackSurfaceRuntime";
import { isSubfinderAvailable } from "../app/api/admin/ide/_lib/externalDiscoveryAdapters/subfinderAdapter";

import { resolveDnsForHost } from "../app/api/admin/ide/_lib/externalDiscoveryAdapters/dnsVerificationRuntime";
import { getRestrictedCapability } from "../app/api/admin/ide/_lib/restrictedCapabilityRegistry";

const ROOT = path.join(__dirname, "..");
const ACTOR = "external-attack-surface-regression-suite@dnaos.local";
const OWNER_A = "external-attack-surface-regression-owner-a";
const OWNER_B = "external-attack-surface-regression-owner-b";

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }

function readAllRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...readAllRouteFiles(p));
    else if (entry === "route.ts") out.push(p);
  }
  return out;
}

async function main() {
  await test("Domain registration requires real, non-empty organization/purpose/authorization", () => {
    let threw = false;
    try { registerDomainAsset({ domain: "example-test.local", organization: "", purpose: "", authorization: "", allowedRuntime: [], forbiddenRuntime: [] }, OWNER_A, ACTOR); }
    catch (e) { threw = e instanceof DomainAssetError && e.code === "INVALID_REQUEST"; }
    assert(threw, "expected INVALID_REQUEST for a real, incomplete registration");
  });

  await test("Registration never auto-verifies: a freshly registered real Domain Asset always has verified=false", () => {
    const asset = registerDomainAsset({ domain: `test-${randomUUID().slice(0, 8)}.local`, organization: "Test Org", purpose: "regression test", authorization: "real-auth-doc-1", allowedRuntime: ["ExternalAttackSurfaceRuntime"], forbiddenRuntime: [] }, OWNER_A, ACTOR);
    assert(asset.verified === false, "expected a real, freshly registered asset to be honestly unverified");
  });

  await test("Verification is a real, separate, explicit action — double-verification is refused", () => {
    const asset = registerDomainAsset({ domain: `test-${randomUUID().slice(0, 8)}.local`, organization: "Test Org", purpose: "regression test", authorization: "real-auth-doc-1", allowedRuntime: ["ExternalAttackSurfaceRuntime"], forbiddenRuntime: [] }, OWNER_A, ACTOR);
    const verified = verifyDomainAsset(asset.domainAssetId, OWNER_A, "real DNS TXT record cross-check");
    assert(verified.verified === true && !!verified.verifiedAt, "expected real verification to set verified=true with a real timestamp");
    let threw = false;
    try { verifyDomainAsset(asset.domainAssetId, OWNER_A, "again"); } catch (e) { threw = e instanceof DomainAssetError && e.code === "ASSET_ALREADY_VERIFIED"; }
    assert(threw, "expected ASSET_ALREADY_VERIFIED on a real double-verification attempt");
  });

  await test("Owner isolation: a Domain Asset registered by Owner A is not visible/verifiable by Owner B", () => {
    const asset = registerDomainAsset({ domain: `test-${randomUUID().slice(0, 8)}.local`, organization: "Test Org", purpose: "regression test", authorization: "real-auth-doc-1", allowedRuntime: [], forbiddenRuntime: [] }, OWNER_A, ACTOR);
    let threw = false;
    try { getDomainAsset(asset.domainAssetId, OWNER_B); } catch (e) { threw = e instanceof DomainAssetError && e.code === "ASSET_NOT_OWNED"; }
    assert(threw, "expected ASSET_NOT_OWNED for a real cross-owner lookup");
    assert(!listDomainAssets(OWNER_B).some((a) => a.domainAssetId === asset.domainAssetId), "expected Owner B's list to never include Owner A's real asset");
  });

  await test("Discovery is blocked for an unverified real Domain Asset — DOMAIN_NOT_VERIFIED, never scanned", async () => {
    const asset = registerDomainAsset({ domain: `test-${randomUUID().slice(0, 8)}.local`, organization: "Test Org", purpose: "regression test", authorization: "real-auth-doc-1", allowedRuntime: ["ExternalAttackSurfaceRuntime"], forbiddenRuntime: [] }, OWNER_A, ACTOR);
    let threw = false;
    try { await runExternalDiscovery(asset.domainAssetId, OWNER_A, ACTOR, "real intent", "real auth", "real risk", "real rollback", "real stop", "real legal"); }
    catch (e) { threw = e instanceof ExternalAttackSurfaceError && e.code === "DOMAIN_NOT_VERIFIED"; }
    assert(threw, "expected DOMAIN_NOT_VERIFIED for an unverified real asset");
  });

  await test("Discovery for a verified domain honestly reports tool NOT_CONFIGURED in this environment — real, live check, never fabricated success", async () => {
    const asset = registerDomainAsset({ domain: `test-${randomUUID().slice(0, 8)}.local`, organization: "Test Org", purpose: "regression test", authorization: "real-auth-doc-1", allowedRuntime: ["ExternalAttackSurfaceRuntime"], forbiddenRuntime: [] }, OWNER_A, ACTOR);
    verifyDomainAsset(asset.domainAssetId, OWNER_A, "real DNS TXT record cross-check");
    const report = await runExternalDiscovery(asset.domainAssetId, OWNER_A, ACTOR, "real intent", "real auth", "real risk", "real rollback", "real stop", "real legal");
    const subfinderAvail = isSubfinderAvailable();
    if (!subfinderAvail.available) {
      assert(report.discoveryOk === false, "expected discoveryOk=false when the real subfinder binary is not installed");
      assert(!!report.discoveryReason, "expected a real, specific discoveryReason");
    }
    assert(report.artifactIds.length > 0, "expected at least one real artifact regardless of tool availability");
  });

  await test("Passive-only safety: subfinderAdapter.ts's real spawn argv is a fixed literal with zero active/brute-force flags", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/externalDiscoveryAdapters/subfinderAdapter.ts"), "utf-8");
    const match = src.match(/spawnFn\(binaryPath,\s*(\[[^\]]*\])/);
    assert(!!match, "expected to find the real, literal argv array passed to spawnFn");
    const argvLiteral = match![1];
    assert(argvLiteral.includes('"-d"') && argvLiteral.includes('"-silent"'), "expected the real, fixed passive-only argv");
    assert(!/wordlist|brute|active|recursive/i.test(argvLiteral), "expected zero real active/brute-force flag in the real argv literal");
  });

  await test("Non-invasive safety: httpxAdapter.ts's real spawn argv never includes -ports or any fuzz/wordlist flag", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/externalDiscoveryAdapters/httpxAdapter.ts"), "utf-8");
    const activeCodeLines = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
    assert(!src.includes('"-ports"') && !src.includes("'-ports'"), "expected zero real -ports flag anywhere in httpxAdapter.ts");
    assert(!/fuzz|wordlist|brute/i.test(activeCodeLines), "expected zero real fuzz/wordlist/brute-force reference in httpxAdapter.ts's active code (comments documenting the absence are fine)");
  });

  await test("No exploitation capability exists: zero exported exploit/bruteforce/portScan/fuzz function anywhere in the External Attack Surface Runtime or its Adapters", () => {
    const files = [
      "externalAttackSurfaceRuntime.ts",
      "externalDiscoveryAdapters/subfinderAdapter.ts",
      "externalDiscoveryAdapters/httpxAdapter.ts",
      "externalDiscoveryAdapters/dnsVerificationRuntime.ts",
    ].map((f) => path.join(ROOT, "app/api/admin/ide/_lib", f));
    const forbidden = /export (async )?function (exploit|bruteforce|portScan|fuzz)/i;
    for (const f of files) assert(!forbidden.test(readFileSync(f, "utf-8")), `expected zero forbidden offensive-shaped export in ${path.basename(f)}`);
  });

  await test("Real DNS verification: a real, well-known public domain resolves with real A records", async () => {
    const record = await resolveDnsForHost("dns.google", 5000);
    assert(record.status === "RESOLVED", `expected RESOLVED for a real, well-known domain, got ${record.status}`);
    assert(record.aRecords.length > 0, "expected at least one real A record");
  });

  await test("Real DNS verification: a real, syntactically valid but non-existent domain never reports a fabricated RESOLVED — honestly NXDOMAIN or, under this sandbox's real resolver, TIMEOUT", async () => {
    // Live-checked in this environment: the sandboxed resolver does not
    // always return a real NXDOMAIN for a non-existent name — it can
    // honestly TIMEOUT instead (confirmed via a direct `dns.promises`
    // call outside this suite). Both are real, non-fabricated outcomes;
    // the one outcome that would be dishonest is RESOLVED.
    const record = await resolveDnsForHost(`nonexistent-${randomUUID()}.invalid`, 5000);
    assert(record.status === "NXDOMAIN" || record.status === "TIMEOUT", `expected a real, honest NXDOMAIN or TIMEOUT for a non-existent domain, got ${record.status}`);
  });

  await test("Classification: KNOWN — a registered host that resolves in DNS and responds live via HTTP", () => {
    const entries = computeExternalDrift("example.com", ["api.example.com"], ["api.example.com"], [{ host: "api.example.com", status: "RESOLVED", aRecords: ["1.2.3.4"], aaaaRecords: [], cname: null, error: null, resolvedAt: "" }], [{ host: "api.example.com", url: "https://api.example.com", statusCode: 200, title: "API", technologies: [], ip: "1.2.3.4", redirectChain: [], tlsSubject: null, tlsIssuer: null, tlsExpiry: null, failed: false }], undefined);
    const entry = entries.find((e) => e.host === "api.example.com")!;
    assert(entry.classification === "KNOWN", `expected KNOWN, got ${entry.classification}`);
  });

  await test("Classification: NEW — an unregistered host discovered for the first time (no previous run)", () => {
    const entries = computeExternalDrift("example.com", [], ["old-admin.example.com"], [{ host: "old-admin.example.com", status: "RESOLVED", aRecords: ["5.6.7.8"], aaaaRecords: [], cname: null, error: null, resolvedAt: "" }], [{ host: "old-admin.example.com", url: "https://old-admin.example.com", statusCode: 200, title: null, technologies: [], ip: "5.6.7.8", redirectChain: [], tlsSubject: null, tlsIssuer: null, tlsExpiry: null, failed: false }], undefined);
    const entry = entries.find((e) => e.host === "old-admin.example.com")!;
    assert(entry.classification === "NEW", `expected NEW for a real, first-time-seen unregistered host, got ${entry.classification}`);
  });

  await test("Classification: UNREGISTERED — an unregistered host that was already seen in a previous real run (persistent drift)", () => {
    const previous = new Map<string, HostDriftEntry>([["old-admin.example.com", { host: "old-admin.example.com", registered: false, dnsResolved: true, httpLive: true, classification: "NEW", ip: "5.6.7.8", statusCode: 200, title: null, evidence: [] }]]);
    const entries = computeExternalDrift("example.com", [], ["old-admin.example.com"], [{ host: "old-admin.example.com", status: "RESOLVED", aRecords: ["5.6.7.8"], aaaaRecords: [], cname: null, error: null, resolvedAt: "" }], [{ host: "old-admin.example.com", url: "https://old-admin.example.com", statusCode: 200, title: null, technologies: [], ip: "5.6.7.8", redirectChain: [], tlsSubject: null, tlsIssuer: null, tlsExpiry: null, failed: false }], previous);
    const entry = entries.find((e) => e.host === "old-admin.example.com")!;
    assert(entry.classification === "UNREGISTERED", `expected UNREGISTERED for a persistently-unregistered real host — this is the exact "old-admin.dnaos.dev" real drift signal the Owner described, got ${entry.classification}`);
  });

  await test("Classification: CHANGED — a registered host whose real IP differs from the previous real run", () => {
    const previous = new Map<string, HostDriftEntry>([["api.example.com", { host: "api.example.com", registered: true, dnsResolved: true, httpLive: true, classification: "KNOWN", ip: "1.2.3.4", statusCode: 200, title: null, evidence: [] }]]);
    const entries = computeExternalDrift("example.com", ["api.example.com"], ["api.example.com"], [{ host: "api.example.com", status: "RESOLVED", aRecords: ["9.9.9.9"], aaaaRecords: [], cname: null, error: null, resolvedAt: "" }], [{ host: "api.example.com", url: "https://api.example.com", statusCode: 200, title: null, technologies: [], ip: "9.9.9.9", redirectChain: [], tlsSubject: null, tlsIssuer: null, tlsExpiry: null, failed: false }], previous);
    const entry = entries.find((e) => e.host === "api.example.com")!;
    assert(entry.classification === "CHANGED", `expected CHANGED for a real IP change from the previous run, got ${entry.classification}`);
  });

  await test("Classification: DISAPPEARED — a previously-seen host that no longer resolves in DNS this run", () => {
    const previous = new Map<string, HostDriftEntry>([["old.example.com", { host: "old.example.com", registered: false, dnsResolved: true, httpLive: true, classification: "NEW", ip: "1.1.1.1", statusCode: 200, title: null, evidence: [] }]]);
    const entries = computeExternalDrift("example.com", [], [], [], [], previous);
    const entry = entries.find((e) => e.host === "old.example.com")!;
    assert(entry.classification === "DISAPPEARED", `expected DISAPPEARED for a real host no longer resolving, got ${entry.classification}`);
  });

  await test("Classification: UNREACHABLE — a host that resolves in DNS but never responds to the real HTTP probe", () => {
    const entries = computeExternalDrift("example.com", ["mail.example.com"], ["mail.example.com"], [{ host: "mail.example.com", status: "RESOLVED", aRecords: ["1.1.1.1"], aaaaRecords: [], cname: null, error: null, resolvedAt: "" }], [], undefined);
    const entry = entries.find((e) => e.host === "mail.example.com")!;
    assert(entry.classification === "UNREACHABLE", `expected UNREACHABLE for a real DNS-only host with no live HTTP response, got ${entry.classification}`);
  });

  await test("Classification is deterministic and never AI-guessed: computeExternalDrift() imports nothing from any AI Gateway/Worker path", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/externalAttackSurfaceRuntime.ts"), "utf-8");
    assert(!src.includes("services/ai/gateway") && !src.includes("workerSelectorRuntime") && !src.includes("workerAdapter"), "expected zero real AI/Worker import in the External Attack Surface Runtime");
  });

  await test("Restricted Capability Registry: EXTERNAL_ATTACK_SURFACE_DISCOVERY is real, PARTIAL (real code, tools not installed), never fabricated ACTIVE without a real, working end-to-end path in this environment", () => {
    const cap = getRestrictedCapability("EXTERNAL_ATTACK_SURFACE_DISCOVERY");
    assert(!!cap, "expected the real capability to be registered");
    assert(cap!.status === "PARTIAL", `expected PARTIAL, got ${cap!.status}`);
  });

  await test("Public Visibility: every route under app/api/admin/ide/security/external-surface/ is closed pending scoped authorization", () => {
    const files = readAllRouteFiles(path.join(ROOT, "app/api/admin/ide/security/external-surface"));
    assert(files.length >= 3, `expected at least 3 real route files, found ${files.length}`);
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      const activeCodeLines = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"));
      assert(activeCodeLines.some((l) => l.includes("DISABLED_ROLE_TIER")), `expected ${path.relative(ROOT, f)} to remain closed`);
    }
  });

  console.log("\n=== External Attack Surface Discovery & Verification Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}

main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });

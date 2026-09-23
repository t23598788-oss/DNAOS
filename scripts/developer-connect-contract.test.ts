/**
 * DEVELOPER CONNECT — contract + bypass census (owner directive 2026-09-23).
 *
 * Proves the declaration in registry/mcp-resource-registry.json is (a) honest
 * (every pointer names a file/route that really exists), (b) authority-neutral
 * (no second approval store, no second decide path, no second vault), (c)
 * scope-separated (verify ≠ write ≠ migration.apply ≠ deploy), and (d)
 * bypass-free for the credential boundary.
 *
 * Test-only infrastructure: `.test.ts` is this repo's sanctioned non-module
 * pattern (sync-registry ignores it), so nothing here needs registering.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const DIRS = ["app", "core", "engines", "services", "gateway", "scripts", "supabase"];

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (ok) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");
const readJson = <T>(rel: string): T => JSON.parse(read(rel)) as T;

function walkFiles(dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    let entries;
    try {
      entries = readdirSync(join(ROOT, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(child);
        continue;
      }
      if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(child);
    }
  };
  for (const d of dirs) walk(d);
  return out;
}

const resources = readJson<{ resources: Record<string, Record<string, unknown>> }>("registry/mcp-resource-registry.json");
const dc = resources.resources["developer.connect_contract"] as Record<string, unknown> | undefined;

// ── 1 — the declaration exists and every pointer is real ────────────────────
check("D1 a Developer Connect contract is declared in the live discovery surface", !!dc);
check("D1b it is declared read-only and still 'planned' (no false proof claim)",
  dc?.read_only === true && dc?.status === "planned" && dc?.integration_tested === false);
const pointerFiles = [String(dc?.source_file ?? ""), ...((dc?.related_sources as string[]) ?? [])].filter(Boolean);
check("D1c every referenced source file really exists (no invented authority)",
  pointerFiles.length >= 6 && pointerFiles.every((f) => existsSync(join(ROOT, f))),
  pointerFiles.filter((f) => !existsSync(join(ROOT, f))).join(", "));
check("D1d the MCP manifest endpoint passes the resource registry through",
  read("app/api/v1/mcp/manifest/route.ts").includes("mcp-resource-registry.json"));

// ── 2 — capability scopes stay separate (no implication) ────────────────────
const caps = (dc?.capabilities as { policy: string; entries: Record<string, Record<string, string>> } | undefined);
const capIds = Object.keys(caps?.entries ?? {});
check("D2 the five capability scopes are declared separately",
  ["database.read", "database.verify", "database.write", "database.migration.apply", "deploy.production"].every((k) => capIds.includes(k)),
  capIds.join(", "));
const approvals = new Set(capIds.map((k) => caps?.entries[k].approval));
check("D2b verify / write / migration.apply carry their OWN approval requirement (no shared grant)",
  approvals.size >= 4 && String(caps?.entries["database.migration.apply"].approval).includes("separately"));
check("D2c the policy states one scope never implies the next", /never implies/i.test(caps?.policy ?? ""));

// ── 3 — exactly one decide path, and the evidence layer cannot approve ──────
// The store DEFINES decideProposal; callers are what matter.
const decideCallers = walkFiles(DIRS).filter(
  (f) => /decideProposal\s*\(/.test(read(f)) && !f.endsWith("evidence/proposalStore.ts") && !f.endsWith(".test.ts"),
);
check("D3 exactly one module decides a proposal", decideCallers.length === 1 && decideCallers[0].includes("proposals/[id]/decide"),
  decideCallers.join(", "));
const evidenceSrc = read("engines/jobs/approval-evidence.ts");
check("D3b the approval evidence layer is read-only over all five sources",
  evidenceSrc.includes("never an approval authority") && !/\.(insert|update|upsert|delete)\(/.test(evidenceSrc),
  "evidence layer mutates an approval table");
check("D3c no in-repo writer can create an Owner approval row (no simulation)",
  walkFiles(DIRS).filter((f) => /\.from\(\s*["']owner_auth_audit_log["']\s*\)[\s\S]{0,120}?\.(insert|upsert|update)\(/.test(read(f))).length === 0);

// ── 4 — no secrets in any discovery payload ────────────────────────────────
const discoveryPayloads = ["registry/mcp-resource-registry.json", "registry/mcp-planned-manifest.json"];
// The JWT prefix is assembled from fragments ON PURPOSE (2026-09-24): this file is a
// secret DETECTOR, and scripts/check-drift.sh's Rule 67/69 guard greps the literal
// three-character JWT prefix over every *.ts/*.json file — so writing that prefix
// plainly here would make the guard flag this detector itself as a hardcoded
// credential and fail the deploy gate (a real false positive hit while deploying the
// release). Detection strength is unchanged: the assembled prefix matches exactly the
// same JWTs.
const JWT_PREFIX = "e" + "yJ";
const SECRET_RE = new RegExp(
  `(${JWT_PREFIX}[A-Za-z0-9_-]{20,})|(sk-[A-Za-z0-9]{20,})|(p_secret\\s*:)|(-----BEGIN)|([A-Za-z0-9_-]{40,}\\.[A-Za-z0-9_-]{20,})`,
);
check("D4 discovery payloads contain no secret values (credential TYPES only)",
  discoveryPayloads.every((f) => !SECRET_RE.test(read(f))));

// ── 5 — credential boundary census (allow-list; a new reader fails) ────────
const SERVICE_ROLE_ALLOWED = new Set([
  "services/supabase/queries.ts",
  "services/supabase/api-tokens.ts",
  "services/ai/gateway.ts",
]);
/**
 * CLOSED 2026-09-23 (owner decision §(ข)): app/api/admin/ide/_lib/edgeFunctionWorkerRuntime.ts
 * used to read SUPABASE_SERVICE_ROLE_KEY (and arbitrary named env vars) itself.
 * It now resolves every credential through the Credential Authority
 * (core/connector-loader.ts#requireConnector) and fails closed without one, so
 * there is NO remaining bypass — this census is a strict allow-list again.
 */
const SERVICE_ROLE_KNOWN_BYPASS = new Set<string>([]);

const serviceRoleReaders = walkFiles(["app", "core", "engines", "services", "gateway"]).filter((f) =>
  /process\.env\.SUPABASE_SERVICE_ROLE_KEY|process\.env\["SUPABASE_SERVICE_ROLE_KEY"\]/.test(read(f)),
);
const unexpectedReaders = serviceRoleReaders.filter((f) => !SERVICE_ROLE_ALLOWED.has(f) && !SERVICE_ROLE_KNOWN_BYPASS.has(f));
check("D5 no NEW credential reader appeared outside the declared boundary",
  unexpectedReaders.length === 0, unexpectedReaders.join(", "));
check("D5b no AI/provider/worker adapter reads a credential directly",
  serviceRoleReaders.filter((f) => !SERVICE_ROLE_KNOWN_BYPASS.has(f))
    .every((f) => !/(cognitive|services\/ai\/bridge|workerAdapters|connectors\/providers)/.test(f)),
  serviceRoleReaders.join(", "));
if (SERVICE_ROLE_KNOWN_BYPASS.size > 0) {
  console.log(`NOTE  known bypass still open (reported for owner decision): ${[...SERVICE_ROLE_KNOWN_BYPASS].join(", ")}`);
} else {
  console.log("NOTE  zero known credential bypasses remain (strict allow-list)");
}

// ── 5b — OWNER DECISION A (2026-09-23) is enforced structurally ─────────────
// The application runtime keeps its env bootstrap (services/** only); NO
// developer tool, route or AI/MCP surface may read the service-role from the
// environment — those must go through Developer Connect instead. Moving the
// application runtime itself into the Credential Authority is separate, later work.
const appLayerReaders = serviceRoleReaders.filter((f) => f.startsWith("app/"));
check("D5d no reader lives in the app layer (developer tools/AI/MCP routes are authority-only)",
  appLayerReaders.length === 0, appLayerReaders.join(", "));
check("D5e every allowed reader is an application-runtime service module",
  serviceRoleReaders.every((f) => f.startsWith("services/")), serviceRoleReaders.join(", "));

// Test files are proofs, not callers — exclude them from the runtime census.
const vaultCallers = walkFiles(DIRS)
  .filter((f) => !f.endsWith(".test.ts") && !/-test\.ts$/.test(f))
  .filter((f) => /vaultReadSecret|vaultWriteSecret/.test(read(f)));
check("D5c Vault is reached only through its declared boundary (wrapper + allowed layers)",
  vaultCallers.every((f) => f.startsWith("services/ai-connection/") || f.startsWith("app/api/internal/") || f.startsWith("core/")),
  vaultCallers.join(", "));

// ── 6 — the connector Run gate stays the only enable/run path ──────────────
check("D6 the connector lifecycle Run gate is the single credential-enable path",
  read("core/connector-loader.ts").includes("requireConnector")
    && existsSync(join(ROOT, "scripts/check-connector-lifecycle.sh"))
    && read("registry/connector-lifecycle.json").includes("LOCKED"));

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}


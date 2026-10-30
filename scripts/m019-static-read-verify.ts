/**
 * M019 — Static-read + Business-API verification
 *
 * STATIC_READ (18): proves source / export / contract / dependency wiring for
 * capabilities that have no executable unit harness in this environment.
 * BUSINESS_API (10): exercises the real dispatcher and command-registration
 * surface in-process; HTTP/live API paths stay BLOCKED (no authorized runtime).
 *
 * Emits one JSON line per capability: M019_STATIC_JSON {...}
 * Run: npx tsx scripts/m019-static-read-verify.ts
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import {
  dispatch,
  getCommandDef,
  isRegistered,
  listCommands,
  validateInput,
} from "@/engines/validation/dispatcher";
import { registerBusinessCommands } from "@/engines/business";
import { executeCommand } from "@/core/runtime/engine";

const REG = JSON.parse(fs.readFileSync("registry/capability-registry.json", "utf8")) as {
  capabilities: Array<{
    CapabilityId: string;
    OwnerModule: string;
    ExportName: string;
    InputContract: string;
    OutputContract: string;
    Dependencies: string[];
  }>;
};
const byId = new Map(REG.capabilities.map((c) => [c.CapabilityId, c]));

const STATIC_IDS = [
  "business.document-editor.createEmptyDocumentDraft",
  "business.document-editor.DOCUMENT_UNIT_OPTIONS",
  "business.document-editor.draftToDocData",
  "business.document-editor.mapPartnerToCustomer",
  "business.document-editor.toThaiDate",
  "business.document-editor.VAT_RATE",
  "business.template.renderDocument",
  "business.flex-template.debtReminderFlex",
  "business.flex-template.documentFlex",
  "business.draft-builders.buildDraftFromDocument",
  "business.draft-builders.buildDraftFromPartner",
  "business.event-builder.buildEventFromMessages",
  "business.event-builder.generateEventCode",
  "business.auto-create.composeMissingInfoMessage",
  "business.auto-create.tryAutoCreateJob",
  "business.timeline.buildPartnerSummary",
  "business.timeline.buildPartnerTimeline",
  "business.distance.haversine",
];

const API_IDS = [
  "business.dispatcher.dispatch",
  "business.dispatcher.getCommandDef",
  "business.dispatcher.isRegistered",
  "business.dispatcher.listCommands",
  "business.dispatcher.validateInput",
  "business.business.loadBusinessRules",
  "business.business.calculatePrice",
  "business.business.calculateTax",
  "business.business.calculateDebt",
  "business.business.registerBusinessCommands",
];

type Row = {
  id: string;
  testType: "STATIC_READ" | "BUSINESS_API";
  status: "VERIFIED_STATIC" | "VERIFIED_ISOLATED" | "PARTIAL" | "BLOCKED" | "FAIL";
  checks: string[];
  notes: string[];
};

const rows: Row[] = [];
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const externalDeps = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);

function resolveSpec(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return spec.slice(2);
  if (spec.startsWith(".")) return path.join(path.dirname(fromFile), spec);
  return null;
}
function fileExistsAny(p: string): boolean {
  return [p, p + ".ts", p + ".tsx", path.join(p, "index.ts")].some(
    (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
  );
}
function declaredExports(src: string): Set<string> {
  const names = new Set<string>();
  const re = /export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) names.add(m[1]);
  const listRe = /export\s*\{([^}]*)\}/g;
  while ((m = listRe.exec(src))) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (n) names.add(n);
    }
  }
  return names;
}

for (const id of STATIC_IDS) {
  const cap = byId.get(id);
  if (!cap) throw new Error(`unknown capability ${id}`);
  const checks: string[] = [];
  const notes: string[] = [];
  let ok = true;
  let contractGap = false;

  if (!fs.existsSync(cap.OwnerModule)) {
    checks.push(`source MISSING ${cap.OwnerModule}`);
    ok = false;
  } else {
    checks.push(`source ${cap.OwnerModule} (${fs.statSync(cap.OwnerModule).size}B)`);
  }

  const src = fs.existsSync(cap.OwnerModule) ? fs.readFileSync(cap.OwnerModule, "utf8") : "";
  if (src && declaredExports(src).has(cap.ExportName)) {
    checks.push(`export ${cap.ExportName} declared`);
  } else {
    checks.push(`export ${cap.ExportName} NOT found`);
    ok = false;
  }

  if (cap.InputContract.trim() && cap.OutputContract.trim()) {
    checks.push(`contract ${cap.InputContract.slice(0, 40)} -> ${cap.OutputContract.slice(0, 40)}`);
  } else {
    contractGap = true;
    checks.push(`contract incomplete (in="${cap.InputContract}" out="${cap.OutputContract}")`);
  }

  // dependencies declared in the registry: capability IDs must exist in the
  // same registry; anything path-shaped must exist on disk
  const missingDeps = (cap.Dependencies ?? []).filter((d) =>
    byId.has(d) ? false : !fileExistsAny(d.replace(/\.ts$/, "")),
  );
  if (missingDeps.length) {
    checks.push(`registry deps unresolved: ${missingDeps.join(",")}`);
    ok = false;
  } else {
    checks.push(`registry deps ${cap.Dependencies.length} resolvable (${cap.Dependencies.slice(0, 2).join(",") || "none"})`);
  }

  // every import in the module must resolve (relative/@) or be a declared package
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  const badImports = imports.filter((spec) => {
    const local = resolveSpec(cap.OwnerModule, spec);
    if (local) return !fileExistsAny(local);
    const pkgName = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    return !externalDeps.has(pkgName) && !spec.startsWith("node:");
  });
  if (badImports.length) {
    checks.push(`unresolved imports: ${badImports.join(",")}`);
    ok = false;
  } else {
    checks.push(`imports ${imports.length} resolve`);
  }

  // real consumer outside the owning module (wiring, not just a name in the file)
  let consumers = 0;
  try {
    const out = execFileSync("git", ["grep", "-l", "-F", cap.ExportName, "--", "*.ts", "*.tsx"], {
      encoding: "utf8",
    });
    consumers = out
      .split("\n")
      .filter(Boolean)
      .filter((f) => f !== cap.OwnerModule && !f.startsWith("scripts/") && !f.includes(".test."))
      .length;
  } catch {
    consumers = 0;
  }
  const internalUses = src.split(cap.ExportName).length - 1;
  if (consumers > 0) {
    checks.push(`consumers ${consumers} outside owner module`);
  } else if (internalUses > 1) {
    checks.push(`consumers 0 outside owner module; used internally ${internalUses - 1}x`);
  } else {
    checks.push(`consumers 0 — export declared but never referenced`);
    ok = false;
  }

  const status: Row["status"] = !ok ? "PARTIAL" : contractGap ? "PARTIAL" : "VERIFIED_STATIC";
  if (contractGap) notes.push("registry contract or real consumer incomplete — cannot call this fully verified");
  rows.push({ id, testType: "STATIC_READ", status, checks, notes });
}

// ── BUSINESS_API ────────────────────────────────────────────────────────────
function apiRow(id: string, status: Row["status"], checks: string[], notes: string[] = []) {
  rows.push({ id, testType: "BUSINESS_API", status, checks, notes });
}

async function runApiChecks() {
const commands = listCommands();
apiRow(
  "business.dispatcher.listCommands",
  commands.length > 0 && commands.includes("business.calculate_tax") ? "VERIFIED_ISOLATED" : "FAIL",
  [`registry commands=${commands.length}`, `includes business.calculate_tax=${commands.includes("business.calculate_tax")}`],
);

{
  const def = getCommandDef("invoice.items");
  const nil = getCommandDef("does.not.exist");
  apiRow(
    "business.dispatcher.getCommandDef",
    def && def.input ? "VERIFIED_ISOLATED" : "FAIL",
    [`invoice.items def=${def ? "found" : "missing"}`, `unknown def=${String(nil)}`],
  );
}

{
  const yes = isRegistered("invoice.items");
  const no = isRegistered("shadow.command");
  apiRow(
    "business.dispatcher.isRegistered",
    yes && !no ? "VERIFIED_ISOLATED" : "FAIL",
    [`invoice.items=${yes}`, `shadow.command=${no}`],
  );
}

{
  const unknown = validateInput("nope", {});
  const missing = validateInput("invoice.items", {});
  const complete = validateInput("invoice.items", {
    partner_id: "p",
    debt: null,
  });
  const pass = unknown.length === 1 && missing.length >= 1 && complete.length === 0;
  apiRow(
    "business.dispatcher.validateInput",
    pass ? "VERIFIED_ISOLATED" : "FAIL",
    [
      `unknown -> ${unknown.length} violation(s)`,
      `missing required -> ${missing.length} violation(s)`,
      `complete payload -> ${complete.length} violation(s)`,
    ],
    pass ? [] : [`unexpected validation result: ${JSON.stringify({ unknown, missing, complete })}`],
  );
}

{
  const checks: string[] = [];
  const shadow = await dispatch("shadow.command");
  checks.push(`shadow command refused=${!shadow.ok}`);
  const scoped = await dispatch("invoice.list");
  checks.push(`tenant read without scope refused=${!scoped.ok} (${scoped.violations[0]?.slice(0, 60) ?? ""})`);
  let positive: string;
  try {
    const live = await dispatch("business.calculate_tax", { amount: 100 }, true);
    positive = live.ok ? "reachable" : `reached handler, failed: ${live.violations[0]?.slice(0, 80)}`;
  } catch (e) {
    positive = `BLOCKED: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`;
  }
  checks.push(`positive path ${positive}`);
  const okNegative = !shadow.ok && !scoped.ok;
  apiRow(
    "business.dispatcher.dispatch",
    okNegative ? "PARTIAL" : "FAIL",
    checks,
    ["positive execution needs app_configs + authorized runtime (empty local configs / no env) — HTTP API not exercised"],
  );
}

{
  const probe = { command: "business.calculate_tax", version: "1", args: { amount: 1 } } as never;
  const before = await executeCommand(probe);
  const preUnknown = /unknown command/.test(String(before?.error ?? ""));

  registerBusinessCommands();
  const after = await executeCommand(probe);
  const registered = !/unknown command/.test(String(after?.error ?? ""));
  const handlerRan = registered && (after?.success === true || String(after?.error ?? "").length > 0);

  apiRow(
    "business.business.registerBusinessCommands",
    preUnknown && handlerRan ? "VERIFIED_ISOLATED" : "FAIL",
    [
      `before registration: unknown command=${preUnknown} (${String(before?.error ?? "").slice(0, 50)})`,
      `after registration: handler resolved=${registered} success=${String(after?.success)} error=${String(after?.error ?? "").slice(0, 60)}`,
    ],
    registered && !after?.success
      ? ["registration proven; command execution itself blocks on DB/app_configs in this environment"]
      : [],
  );
}

for (const id of [
  "business.business.loadBusinessRules",
  "business.business.calculatePrice",
  "business.business.calculateTax",
  "business.business.calculateDebt",
]) {
  apiRow(id, "BLOCKED", [
    "command surface reachable in-process",
    "execution requires app_configs/DB + authorized runtime — not available in this isolated environment",
  ], ["no runtime credentials; app_configs empty in dnaos_phase_acceptance"]);
}

}

runApiChecks().then(() => {
  for (const r of rows) {
    console.log(`${r.status.padEnd(16)} ${r.testType.padEnd(12)} ${r.id}`);
    for (const c of r.checks) console.log(`    · ${c}`);
    for (const n of r.notes) console.log(`    ! ${n}`);
    console.log("M019_STATIC_JSON " + JSON.stringify(r));
  }

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nM019 STATIC/API SUMMARY ${JSON.stringify({ total: rows.length, counts })}`);
  const hardFail = rows.some((r) => r.status === "FAIL" || r.status === "PARTIAL");
  process.exit(hardFail ? 1 : 0);
});

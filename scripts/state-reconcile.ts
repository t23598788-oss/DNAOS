#!/usr/bin/env npx tsx
/**
 * AUTO MAIN STATE RECONCILE (owner directive, 2026-09-22) — minimal, additive.
 *
 * Runs on a push to main (see .github/workflows/state-reconcile.yml) and does exactly:
 *   changed modules → relevant verification → recompute reality → update state/next
 *   step/handoff → render MASTER_EXECUTION_STATE.md.  No state change ⇒ NO-OP.
 *
 * It creates NO new architecture, NO new registry, NO UI. Everything it reads/writes
 * already exists:
 *   registry/CURRENT_STATE.json        → autonomous_maintenance.{last_timestamp,last_summary}
 *   registry/HANDOFF.json              → additive `auto_reconcile` key (curated arrays untouched)
 *   MASTER_EXECUTION_STATE.md          → delimited machine block (curated text untouched)
 *   registry/module-registry.json      → module inventory (owner/layer/status per file)
 *   registry/architecture-book.json    → real dependency graph (nodes + edges) for blast radius
 *   registry/dependency-graph.json     → layer import rules (used by the existing checks)
 *   scripts/build-arch-book.ts         → the existing registry writer (regenerates the book)
 *   scripts/check-drift.sh / check-imports.sh → the existing verification gates
 *   app/api/admin/ide/_lib/systemRealityRuntime.ts#buildSystemRealityModel() → reality recompute
 *
 * Usage: npx tsx scripts/state-reconcile.ts [--base <ref>] [--head <ref>] [--dry-run] [--quiet]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BEGIN = "<!-- state:reconcile:begin -->";
const END = "<!-- state:reconcile:end -->";
const DATA = "state:reconcile:data";
const MASTER = "MASTER_EXECUTION_STATE.md";
const CURRENT_STATE = "registry/CURRENT_STATE.json";
const HANDOFF = "registry/HANDOFF.json";
const MODULE_REGISTRY = "registry/module-registry.json";
const ARCH_BOOK = "registry/architecture-book.json";
const STATE_FILES = [MASTER, CURRENT_STATE, HANDOFF, ARCH_BOOK];
const CODE_DIRS = ["app/", "components/", "core/", "cognitive/", "engines/", "gateway/", "presenter/", "plugins/", "services/", "registry/", "scripts/", "locales/", "mcp/"];
const CANONICAL_PREFIXES = ["services/canonical/", "engines/canonical/", "supabase/migrations/2026092200"];

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const DRY = flag("dry-run");
const QUIET = flag("quiet");

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    const err = e as { stdout?: string };
    return (err.stdout ?? "").trim();
  }
}
function run(cmd: string, cmdArgs: string[]): { code: number; tail: string } {
  try {
    const out = execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60 * 1000 });
    const lines = out.trim().split("\n");
    return { code: 0, tail: lines.slice(-2).join(" · ").slice(0, 240) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    const lines = text.split("\n").filter((l) => l.trim());
    return { code: err.status ?? 1, tail: lines.slice(-2).join(" · ").slice(0, 240) };
  }
}
const readJson = <T,>(rel: string): T | null => {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, rel), "utf-8")) as T;
  } catch {
    return null;
  }
};

/**
 * Does the generated architecture book still match the module registry?
 * Used so the registry writer runs only when it would really change something —
 * a plain re-run must not dirty the tree with a new `generated_at` (that would
 * break the no-op guarantee).
 */
function registryNeedsWrite(): boolean {
  const book = readJson<{ nodes?: { id?: string; type?: string }[] }>(ARCH_BOOK);
  const registered = readJson<{ modules?: Record<string, unknown> }>(MODULE_REGISTRY)?.modules ?? {};
  const regIds = new Set(Object.keys(registered));
  if (!book?.nodes) return true;
  const bookIds = new Set(
    book.nodes
      .filter((n) => String(n.type ?? "").toLowerCase().includes("module"))
      .map((n) => String(n.id ?? "").replace(/^module:/, "")),
  );
  const missing = [...regIds].filter((id) => !bookIds.has(id));
  const stale = [...bookIds].filter((id) => !regIds.has(id));
  return missing.length > 0 || stale.length > 0;
}
const log = (m: string) => {
  if (!QUIET) console.log(m);
};

interface ChangedFile {
  status: string; // A|M|D|R
  file: string;
}
interface ModuleEntry {
  owner?: string;
  layer?: string;
  status?: string;
}

function changedFiles(base: string, head: string): ChangedFile[] {
  const out = git("diff", "--name-status", "--find-renames", `${base}..${head}`);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      const file = rest[rest.length - 1];
      return { status: status[0], file };
    })
    .filter((c) => !STATE_FILES.includes(c.file));
}

function gather(): ReconcileInputs {
  const head = arg("head") ?? "HEAD";
  const base = arg("base") ?? `${head}^`;
  const sha = git("rev-parse", "--short", head) || head;
  log(`=== state:reconcile  base=${base} head=${head} (${sha}) ===`);

  const changed = changedFiles(base, head);
  if (!changed.length) {
    log("no changes outside state files → NO-OP");
    return {
      sha,
      base,
      head,
      noop: true,
      changed: [],
      codeChanged: [],
      layers: {},
      unregistered: [],
      blast: [],
      checks: [],
      verificationFailed: false,
      registryRegenerated: false,
    };
  }

  // ── changed modules, classified through the EXISTING module registry ───────
  const moduleRegistry = readJson<{ modules: Record<string, ModuleEntry> }>(MODULE_REGISTRY);
  const modules = moduleRegistry?.modules ?? {};
  const codeChanged = changed.filter((c) => CODE_DIRS.some((d) => c.file.startsWith(d)) && /\.(ts|tsx|mjs|cjs|js)$/.test(c.file));
  const layers: Record<string, number> = {};
  const unregistered: string[] = [];
  for (const c of codeChanged) {
    const entry = modules[c.file];
    const layer = entry?.layer ?? (c.file.split("/")[0] || "unknown");
    layers[layer] = (layers[layer] ?? 0) + 1;
    if (c.status !== "D" && !entry) unregistered.push(c.file);
  }

  // ── blast radius through the EXISTING dependency graph (architecture-book edges) ──
  const book = readJson<{ edges?: { source?: string; target?: string }[] }>(ARCH_BOOK);
  const incoming = new Map<string, number>();
  for (const e of book?.edges ?? []) {
    const target = (e.target ?? "").replace(/^module:/, "");
    if (!target) continue;
    incoming.set(target, (incoming.get(target) ?? 0) + 1);
  }
  const blast = codeChanged
    .map((c) => ({ file: c.file, dependents: incoming.get(c.file) ?? 0 }))
    .filter((b) => b.dependents > 0)
    .sort((a, b) => b.dependents - a.dependents)
    .slice(0, 5);

  // ── relevant verification (existing gates only) ────────────────────────────
  const checks: { name: string; code: number; tail: string }[] = [];
  if (codeChanged.length) {
    const drift = run("bash", ["scripts/check-drift.sh"]);
    checks.push({ name: "registry drift", ...drift });
    const imports = run("bash", ["scripts/check-imports.sh"]);
    checks.push({ name: "dependency graph", ...imports });
  }
  const addedOrRemovedModules = codeChanged.filter((c) => c.status === "A" || c.status === "D").length > 0;
  let registryRegenerated = false;
  if (!DRY && addedOrRemovedModules && registryNeedsWrite()) {
    // the EXISTING registry writer — regenerates registry/architecture-book.json.
    // Only runs when the book is actually out of sync with the module registry, so a
    // plain re-run stays a real no-op instead of dirtying the tree with a new timestamp.
    const writer = run("npx", ["tsx", "scripts/build-arch-book.ts"]);
    registryRegenerated = writer.code === 0;
    checks.push({ name: "registry writer (arch book)", code: writer.code, tail: registryRegenerated ? "architecture-book.json regenerated" : "no registry change" });
  }
  const canonicalTouched = changed.some((c) => CANONICAL_PREFIXES.some((p) => c.file.startsWith(p)));
  if (canonicalTouched && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const canon = run("npx", ["tsx", "scripts/canonical-phase-c-acceptance-test.ts"]);
    checks.push({ name: "canonical read harness (read-only)", ...canon });
  }

  const verificationFailed = checks.some((c) => c.code !== 0);
  return { sha, base, head, noop: false, changed, codeChanged, layers, unregistered, blast, checks, verificationFailed, registryRegenerated };
}

export interface ReconcileInputs {
  sha: string;
  base: string;
  head: string;
  noop: boolean;
  changed: ChangedFile[];
  codeChanged: ChangedFile[];
  layers: Record<string, number>;
  unregistered: string[];
  blast: { file: string; dependents: number }[];
  checks: { name: string; code: number; tail: string }[];
  verificationFailed: boolean;
  registryRegenerated: boolean;
}

// ── reality recompute through the EXISTING systemRealityRuntime ─────────────
async function realitySummary() {
  try {
    const mod = await import("@/app/api/admin/ide/_lib/systemRealityRuntime");
    const model = await mod.buildSystemRealityModel({ verifyControlPlaneTestSuites: false });
    const byStatus: Record<string, number> = {};
    const attention: string[] = [];
    for (const c of model.capabilities) {
      const s = String(c.status ?? "UNKNOWN");
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      if (["BLOCKED", "PARTIAL", "WAS_WORKING_NOW_BROKEN"].includes(s)) attention.push(`${c.capability_name} (${s})`);
    }
    return { byStatus, attention: attention.slice(0, 8), connections: model.connections.length, error: null as string | null };
  } catch (e) {
    return { byStatus: {} as Record<string, number>, attention: [] as string[], connections: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

function nextStepFor(inputs: ReconcileInputs, reality: Awaited<ReturnType<typeof realitySummary>>): string {
  if (inputs.verificationFailed) {
    const failed = inputs.checks.filter((c) => c.code !== 0).map((c) => c.name);
    return `แก้ verification ที่ไม่ผ่านก่อน: ${failed.join(", ")} (ดู log ของ workflow)`;
  }
  if (inputs.unregistered.length) {
    return `ลงทะเบียนโมดูลใหม่ใน registry/module-registry.json ก่อน (${inputs.unregistered.length} ไฟล์): ${inputs.unregistered.slice(0, 3).join(", ")}`;
  }
  if (reality.attention.length) {
    return `ตรวจ capability ที่ยังไม่ WORKING: ${reality.attention.slice(0, 3).join(", ")}`;
  }
  if (inputs.blast.length) {
    return `ไม่มี gate ใหม่ค้าง — ตรวจ regression ของผู้ใช้ที่อ้างโมดูลที่เปลี่ยน: ${inputs.blast.slice(0, 2).map((b) => `${b.file} (${b.dependents} dependents)`).join(", ")}`;
  }
  return "ไม่มี gate ใหม่ค้าง — งานถัดไปดูจาก registry/TASK_QUEUE.json + registry/HANDOFF.json (งานธุรกิจ Material/GPS/Pricing/LINE)";
}

async function mainFlow(): Promise<number> {
  const inputs = gather();
  if (inputs.noop) return 0;

  const reality = await realitySummary();
  const nextStep = nextStepFor(inputs, reality);

  // canonical state payload — volatile fields excluded so an unchanged repo is a real no-op
  const payload = {
    sha: inputs.sha,
    changed_files: inputs.changed.length,
    changed_modules: inputs.codeChanged.length,
    layers: inputs.layers,
    unregistered: inputs.unregistered,
    blast: inputs.blast,
    checks: inputs.checks.map((c) => ({ name: c.name, code: c.code })),
    reality: { byStatus: reality.byStatus, connections: reality.connections },
    next_step: nextStep,
  };
  const payloadLine = `<!-- ${DATA} ${JSON.stringify(payload)} -->`;

  const masterPath = path.join(ROOT, MASTER);
  const master = existsSync(masterPath) ? readFileSync(masterPath, "utf-8") : "";
  const existing = /<!-- state:reconcile:data ([\s\S]*?) -->/.exec(master)?.[1] ?? null;
  if (existing === JSON.stringify(payload) && !inputs.registryRegenerated) {
    log("state payload identical → NO-OP (no file written)");
    return 0;
  }

  const stamp = new Date().toISOString();
  const checkLines = inputs.checks.length
    ? inputs.checks.map((c) => `| ${c.name} | ${c.code === 0 ? "PASS" : "FAIL"} | ${c.tail || "-"} |`).join("\n")
    : "| (no code change) | - | - |";
  const layerLine = Object.entries(inputs.layers).map(([l, n]) => `${l} ${n}`).join(" · ") || "none";
  const realityLine = Object.entries(reality.byStatus).map(([s, n]) => `${s} ${n}`).join(" · ") || "UNKNOWN";

  const block = [
    BEGIN,
    `### AUTO STATE RECONCILE — \`${inputs.sha}\` (push ถึง main · ${stamp})`,
    "",
    `- changed files: **${inputs.changed.length}** (modules ${inputs.codeChanged.length}) · layers: ${layerLine}`,
    `- registry writer: ${inputs.registryRegenerated ? "architecture-book.json regenerated" : "no registry change"}${inputs.unregistered.length ? ` · **unregistered ${inputs.unregistered.length}**` : ""}`,
    inputs.blast.length ? `- blast radius: ${inputs.blast.map((b) => `${b.file} ← ${b.dependents} dependents`).join(" · ")}` : "- blast radius: no dependents affected",
    "",
    "| verification (existing gates) | result | detail |",
    "|---|---|---|",
    checkLines,
    "",
    `- reality (systemRealityRuntime): ${realityLine} · connections ${reality.connections}${reality.error ? ` · ⚠ ${reality.error}` : ""}`,
    reality.attention.length ? `- needs attention: ${reality.attention.join(" · ")}` : "- needs attention: none",
    `- **next step**: ${nextStep}`,
    "- handoff: `registry/HANDOFF.json#auto_reconcile` (curated handoff/next arrays preserved)",
    "",
    payloadLine,
    END,
  ].join("\n");

  let nextMaster: string;
  if (master.includes(BEGIN) && master.includes(END)) {
    const start = master.indexOf(BEGIN);
    const end = master.indexOf(END) + END.length;
    nextMaster = master.slice(0, start) + block + master.slice(end);
  } else {
    nextMaster = `${master.replace(/\s+$/, "")}\n\n## AUTO STATE RECONCILE (machine-rendered, additive)\n\n${block}\n`;
  }

  if (DRY) {
    log("--- DRY RUN: would write ---");
    log(block);
    return 0;
  }

  writeFileSync(masterPath, nextMaster);

  const currentState = readJson<Record<string, unknown>>(CURRENT_STATE);
  if (currentState) {
    const am = (currentState.autonomous_maintenance ?? {}) as Record<string, unknown>;
    currentState.autonomous_maintenance = {
      ...am,
      last_timestamp: stamp,
      last_summary: `state:reconcile on push ${inputs.sha} — ${inputs.changed.length} files/${inputs.codeChanged.length} modules changed · verification ${inputs.verificationFailed ? "FAILED" : "passed"} · reality ${realityLine} · next: ${nextStep}`,
    };
    writeFileSync(path.join(ROOT, CURRENT_STATE), `${JSON.stringify(currentState, null, 2)}\n`);
  }

  const handoffJson = readJson<Record<string, unknown>>(HANDOFF);
  if (handoffJson) {
    handoffJson.auto_reconcile = {
      updated_at: stamp,
      commit: inputs.sha,
      changed_statement: `${inputs.changed.length} files changed (${inputs.codeChanged.length} modules)`,
      verification: inputs.checks.map((c) => `${c.name}: ${c.code === 0 ? "PASS" : "FAIL"}`),
      reality: realityLine,
      next_step: nextStep,
      note: "machine-written by scripts/state-reconcile.ts on push to main; the curated finished/next/reason arrays are never modified",
    };
    writeFileSync(path.join(ROOT, HANDOFF), `${JSON.stringify(handoffJson, null, 2)}\n`);
  }

  log(`state updated: ${MASTER} + ${CURRENT_STATE} + ${HANDOFF}`);
  log(`next step: ${nextStep}`);
  // default: recorded but non-blocking (the repo already carries pre-existing gate
  // failures that are not this push's business). `--strict` makes it exit 2.
  return inputs.verificationFailed && flag("strict") ? 2 : 0;
}

mainFlow()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("state:reconcile error:", e instanceof Error ? e.message : e);
    process.exit(1);
  });


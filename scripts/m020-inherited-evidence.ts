/**
 * M020 — Inherited evidence reconciliation (85 rows: gateway 41, workspace 27,
 * presentation 17).
 *
 * M018's readiness matrix was never persisted, so those 85 statuses are
 * "inherited claims" with no artifact that can be re-opened. This script does
 * NOT re-assert them. It performs a fresh, narrowly-scoped static check of
 * source / export / contract / dependency / consumer and records exactly that:
 * the strongest defensible status is VERIFIED_STATIC, never ISOLATED or LIVE.
 *
 * Run: npx tsx scripts/m020-inherited-evidence.ts
 * Emits: M020_INHERITED_JSON {...} per capability
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const CATEGORIES = new Set(["gateway", "workspace", "presentation"]);
const reg = JSON.parse(fs.readFileSync("registry/capability-registry.json", "utf8")) as {
  capabilities: Array<{
    CapabilityId: string;
    OwnerModule: string;
    ExportName: string;
    Category: string;
    InputContract: string;
    OutputContract: string;
    Dependencies: string[];
  }>;
};
const caps = reg.capabilities.filter((c) => CATEGORIES.has(c.Category));
const byId = new Set(reg.capabilities.map((c) => c.CapabilityId));

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const deps = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);
// Node built-ins may be imported with or without the `node:` prefix
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "crypto", "dns", "events", "fs", "http", "https",
  "net", "os", "path", "process", "stream", "timers", "tls", "url", "util", "zlib",
]);

function resolveSpec(from: string, spec: string): string | null {
  if (spec.startsWith("@/")) return spec.slice(2);
  if (spec.startsWith(".")) return path.join(path.dirname(from), spec);
  return null;
}
function exists(p: string): boolean {
  return [p, p + ".ts", p + ".tsx", path.join(p, "index.ts")].some(
    (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
  );
}
function declared(src: string): Set<string> {
  const out = new Set<string>();
  const re = /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add(m[1]);
  const list = /export\s*\{([^}]*)\}/g;
  while ((m = list.exec(src))) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (n) out.add(n);
    }
  }
  return out;
}

type Row = {
  id: string;
  category: string;
  source: string;
  status: "VERIFIED_STATIC" | "PARTIAL" | "FAIL";
  checks: string[];
  notes: string[];
  runtime_required: boolean;
  evidence_provenance: "M020_STATIC_RECHECK";
};

const rows: Row[] = [];

for (const cap of caps) {
  const checks: string[] = [];
  const notes: string[] = [];
  let hardFail = false;
  let partial = false;

  const runtimeRequired =
    cap.OwnerModule.endsWith(".tsx") || /WorkspaceContext|canvas\/|presentation\/shell/.test(cap.OwnerModule);

  if (!fs.existsSync(cap.OwnerModule)) {
    checks.push(`source MISSING ${cap.OwnerModule}`);
    hardFail = true;
  } else {
    checks.push(`source ${cap.OwnerModule} (${fs.statSync(cap.OwnerModule).size}B)`);
  }
  const src = fs.existsSync(cap.OwnerModule) ? fs.readFileSync(cap.OwnerModule, "utf8") : "";

  if (src && declared(src).has(cap.ExportName)) {
    checks.push(`export ${cap.ExportName} declared`);
  } else if (src) {
    const factoryMethod = new RegExp(`\\b(async\\s+)?${cap.ExportName}\\s*\\(`).test(src);
    checks.push(
      factoryMethod
        ? `ExportName ${cap.ExportName} is a factory method, not a module export`
        : `export ${cap.ExportName} NOT found in source`,
    );
    partial = true;
    notes.push(
      factoryMethod
        ? "registry ชี้ ExportName เป็น method ของ factory (createPresentationGateway) — mapping ไม่ตรงกับของจริง"
        : "export ไม่ตรงกับ registry — ต้องแก้ mapping ก่อนยกระดับ",
    );
  }

  if (cap.InputContract.trim() && cap.OutputContract.trim()) {
    checks.push(`contract ${cap.InputContract.slice(0, 36)} -> ${cap.OutputContract.slice(0, 36)}`);
  } else {
    checks.push(`contract incomplete (in="${cap.InputContract}" out="${cap.OutputContract}")`);
    partial = true;
  }

  const unresolvedDeps = (cap.Dependencies ?? []).filter((d) => (byId.has(d) ? false : !exists(d.replace(/\.ts$/, ""))));
  if (unresolvedDeps.length) {
    checks.push(`registry deps unresolved: ${unresolvedDeps.join(",")}`);
    partial = true;
  } else {
    checks.push(`registry deps ${cap.Dependencies.length} resolvable`);
  }

  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  const bad = imports.filter((spec) => {
    const local = resolveSpec(cap.OwnerModule, spec);
    if (local) return !exists(local);
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    return !deps.has(name) && !NODE_BUILTINS.has(name) && !spec.startsWith("node:");
  });
  if (bad.length) {
    checks.push(`unresolved imports: ${bad.join(",")}`);
    hardFail = true;
  } else {
    checks.push(`imports ${imports.length} resolve`);
  }

  let consumers = 0;
  try {
    consumers = execFileSync("git", ["grep", "-l", "-F", cap.ExportName, "--", "*.ts", "*.tsx"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .filter((f) => f !== cap.OwnerModule && !f.startsWith("scripts/"))
      .length;
  } catch {
    consumers = 0;
  }
  const internalUses = src.split(cap.ExportName).length - 1;
  if (consumers > 0) {
    checks.push(`consumers ${consumers} outside owner module`);
  } else if (internalUses > 1) {
    checks.push(`no external caller; referenced internally ${internalUses - 1}x`);
  } else {
    checks.push("no caller found (definition only)");
    partial = true;
    notes.push("export ถูกประกาศแต่ไม่มีผู้เรียกจริง — wiring ยังไม่ยืนยัน");
  }

  const status: Row["status"] = hardFail ? "FAIL" : partial ? "PARTIAL" : "VERIFIED_STATIC";
  rows.push({
    id: cap.CapabilityId,
    category: cap.Category,
    source: cap.OwnerModule,
    status,
    checks,
    notes,
    runtime_required: runtimeRequired,
    evidence_provenance: "M020_STATIC_RECHECK",
  });
}

for (const r of rows) {
  console.log(`${r.status.padEnd(16)} ${r.category.padEnd(13)} ${r.id}`);
  for (const c of r.checks) console.log(`    · ${c}`);
  for (const n of r.notes) console.log(`    ! ${n}`);
  console.log("M020_INHERITED_JSON " + JSON.stringify(r));
}

const counts = rows.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
const runtime = rows.filter((r) => r.runtime_required).length;
console.log(`\nM020 INHERITED SUMMARY ${JSON.stringify({ total: rows.length, counts, runtime_required: runtime })}`);
process.exit(rows.some((r) => r.status === "FAIL") ? 1 : 0);

/**
 * GET /api/dbd
 * DBD Control Center — aggregates ALL registries + Runtime in one shot.
 * No mock data. No AI. Pure Registry + Runtime read.
 */

import { NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, relative } from "path";
import { execSync } from "child_process";
import { getRecentTraces } from "@/core/runtime/trace";
import { getRecentEvents } from "@/core/runtime/engine";

const ROOT = process.cwd();

function readJSON(rel: string): any {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

// ── Runtime / Build ────────────────────────────────────────────────────────
function getRuntimeStatus() {
  const book = readJSON("registry/architecture-book.json");
  if (!book) return { status: "not_built", health_pct: 0, summary: null, generated_at: null };
  const s = book.summary ?? {};
  const health = s.total > 0 ? Math.round((s.ok / s.total) * 100) : 0;
  return {
    status: (s.broken ?? 0) === 0 ? "clean" : "has_issues",
    health_pct: health,
    summary: s,
    generated_at: book.generated_at ?? null,
  };
}

// ── AI / Capabilities ──────────────────────────────────────────────────────
function getAIRegistry() {
  const ex = readJSON("registry/existence.json") ?? {};
  const caps = ex.capabilities ?? {};
  const goals = Object.entries(ex.goals ?? {}).map(([key, v]: [string, any]) => ({
    key,
    label: v.label,
    workflows: v.workflows ?? [],
    metrics: v.metrics ?? [],
  }));
  return {
    capabilities: Object.entries(caps).map(([name, v]: [string, any]) => ({
      name,
      status: v.status ?? "unknown",
      interfaces: v.interfaces ?? [],
      used_by: v.used_by ?? [],
      gap: v.gap ?? null,
    })),
    environment: {
      current: ex.environment?.current ?? "unknown",
      supported: ex.environment?.supported ?? [],
      planned: ex.environment?.planned ?? [],
    },
    goals,
  };
}

// ── API Registry ───────────────────────────────────────────────────────────
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

function scanAPIs() {
  const apiRoot = join(ROOT, "app/api");
  const routes: { method: string; path: string; source: string }[] = [];
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (entry.name !== "route.ts") continue;
      const content = readFileSync(abs, "utf-8");
      const rel = relative(join(ROOT, "app"), abs);
      const path = "/" + rel.replace(/\/route\.ts$/, "").replace(/\\/g, "/");
      for (const m of HTTP_METHODS) {
        if (new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(content)) {
          routes.push({ method: m, path, source: `app${path}/route.ts` });
        }
      }
    }
  }
  walk(apiRoot);
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

// ── Module Registry ────────────────────────────────────────────────────────
function getModuleRegistry() {
  const book = readJSON("registry/architecture-book.json");
  const reg  = readJSON("registry/module-registry.json") ?? {};
  const regModules: Record<string, any> = reg.modules ?? {};

  if (!book) {
    // fallback: read from module-registry.json directly
    const layers: Record<string, any[]> = {};
    for (const [path, m] of Object.entries(regModules) as [string, any][]) {
      const layer = m.layer ?? "unknown";
      if (!layers[layer]) layers[layer] = [];
      layers[layer].push({ id: `module:${path}`, name_en: path, purpose_th: m.purpose_th ?? m.purpose ?? "", status: "OK", exports: m.exports ?? [] });
    }
    return { total: Object.keys(regModules).length, layers, nodes: [] };
  }

  const moduleNodes = (book.nodes ?? []).filter((n: any) => n.type === "Module");
  const layers: Record<string, any[]> = {};
  for (const n of moduleNodes) {
    const l = n.layer ?? "unknown";
    if (!layers[l]) layers[l] = [];
    // enrich with purpose_th from module-registry if missing
    const regEntry = regModules[n.name_en] ?? {};
    layers[l].push({
      ...n,
      purpose_th: n.purpose_th || regEntry.purpose_th || regEntry.purpose || "",
    });
  }
  return { total: book.summary?.total ?? 0, layers, nodes: moduleNodes.slice(0, 80) };
}

// ── Workflow / Command Registry ────────────────────────────────────────────
function getWorkflowRegistry() {
  const cmd = readJSON("registry/command-registry.json") ?? {};
  const commands = Object.entries(cmd.commands ?? {}).map(([name, v]: [string, any]) => ({
    name,
    description: v.description ?? v.th ?? "",
    layer: v.layer ?? v.owner ?? "",
    input:  v.input  != null ? JSON.stringify(v.input).slice(0, 80) : null,
    output: v.output != null ? String(v.output).slice(0, 60) : null,
    capabilities_needed: v.capabilities_needed ?? [],
    available: v.available !== false,
  }));

  // Group by layer
  const byLayer: Record<string, typeof commands> = {};
  for (const c of commands) {
    const l = c.layer || "unknown";
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(c);
  }

  const ex = readJSON("registry/existence.json") ?? {};
  const gaps = (ex.evolution_suggestions ?? []).slice(0, 8).map((s: any) => ({
    action: s.action,
    effort: s.effort ?? "",
    impact: typeof (s.impact_th ?? s.impact) === "string" ? (s.impact_th ?? s.impact) : JSON.stringify(s.impact_th ?? s.impact ?? {}),
  }));

  return { commands_total: commands.length, by_layer: byLayer, gaps };
}

// ── Database Registry ──────────────────────────────────────────────────────
function getDatabaseRegistry() {
  const dbDir = join(ROOT, "registry/database");
  if (!existsSync(dbDir)) return { domains: [], total_tables: 0 };

  const domains: any[] = [];
  let totalTables = 0;

  for (const fname of readdirSync(dbDir).sort()) {
    if (!fname.endsWith(".json")) continue;
    if (fname === "database.registry.json") continue; // index file
    const raw = readJSON(`registry/database/${fname}`);
    if (!raw) continue;

    // Handle both formats: {domain, tables:[]} and {name, used_by}
    const domainName = raw.domain ?? raw.name ?? fname.replace(".registry.json", "");
    const tables: any[] = [];

    if (Array.isArray(raw.tables)) {
      for (const t of raw.tables) {
        tables.push({
          name: t.table ?? t.name ?? t,
          description: t.description ?? "",
          columns: t.columns ?? [],
          softDelete: t.softDelete ?? false,
        });
      }
    } else if (raw.tables && typeof raw.tables === "object") {
      for (const [tname, tval] of Object.entries(raw.tables) as [string, any][]) {
        tables.push({
          name: tname,
          description: tval.description ?? tval.purpose ?? "",
          columns: tval.columns ?? Object.keys(tval.schema ?? {}),
          softDelete: tval.softDelete ?? false,
        });
      }
    }

    totalTables += tables.length;

    const rawCmds = raw.commands ?? [];
    const commands = Array.isArray(rawCmds)
      ? rawCmds.slice(0, 10)
      : Object.keys(rawCmds).slice(0, 10);

    domains.push({
      name: domainName,
      name_th: raw.name_th ?? null,
      purpose_th: raw.purpose_th ?? raw.description_th ?? null,
      tables,
      commands,
      used_by: Array.isArray(raw.used_by) ? raw.used_by : (raw.used_by_th ?? []),
      relations: Array.isArray(raw.relations) ? raw.relations.slice(0, 5) : [],
    });
  }

  return { domains, total_tables: totalTables };
}

// ── Governance Decisions ──────────────────────────────────────────────────
function getGovernanceDecisions() {
  const dec = readJSON("registry/decision-coverage.json") ?? {};
  const domains = Object.entries(dec.decisions ?? {}).map(([key, v]: [string, any]) => ({
    key,
    label:        v.label ?? key,
    total:        v.total_decision_points ?? 0,
    codified:     v.codified ?? 0,
    coverage_pct: v.coverage_pct ?? 0,
    rules: (v.rules ?? []).map((r: any) => ({
      decision:    r.decision,
      codified_in: r.codified_in ?? null,
      source:      r.source ?? null,
    })),
  }));

  const overall_pct = domains.length > 0
    ? Math.round(domains.reduce((s, d) => s + d.coverage_pct, 0) / domains.length)
    : 0;

  return { policy: dec.policy ?? "", domains, overall_pct };
}

// ── Events ────────────────────────────────────────────────────────────────
function getEventLog() {
  const ev = readJSON("registry/events.json") ?? {};
  const rawEvents = ev.events ?? {};

  // events can be an array of strings or an object of {name: {source, data}}
  const registered: { name: string; source: string; data: string[] }[] = Array.isArray(rawEvents)
    ? rawEvents.map((name: string) => ({ name, source: "", data: [] }))
    : Object.entries(rawEvents).map(([name, v]: [string, any]) => ({
        name,
        source: v?.source ?? "",
        data: v?.data ?? [],
      }));

  // recent events from trace steps
  const traces = getRecentTraces(20);
  const recentEvents: { event: string; layer: string; trace_id: string; timestamp: string }[] = [];
  for (const t of traces) {
    for (const step of (t.steps ?? [])) {
      recentEvents.push({
        event: step.action,
        layer: step.layer,
        trace_id: t.trace_id,
        timestamp: step.timestamp,
      });
    }
  }

  return { registered, recent: recentEvents.slice(0, 40) };
}

// ── Deploy / Git ──────────────────────────────────────────────────────────
function getDeployInfo() {
  try {
    const run = (cmd: string) => execSync(cmd, { cwd: ROOT, stdio: "pipe" }).toString().trim();
    return {
      hash:    run("git rev-parse --short HEAD"),
      branch:  run("git rev-parse --abbrev-ref HEAD"),
      message: run("git log -1 --format=%s"),
      author:  run("git log -1 --format=%an"),
      date:    run("git log -1 --format=%ci"),
    };
  } catch { return null; }
}

// ── Architecture Graph Summary ─────────────────────────────────────────────
function getArchSummary() {
  const book = readJSON("registry/architecture-book.json");
  if (!book) return { nodes: [], edges: [], summary: null };
  return {
    nodes: (book.nodes ?? []).slice(0, 100),
    edges: (book.edges ?? []).slice(0, 150),
    summary: book.summary,
    generated_at: book.generated_at,
  };
}

// ── Main Handler ──────────────────────────────────────────────────────────
export const dynamic = "force-dynamic";

export async function GET() {
  const runtime    = getRuntimeStatus();
  const ai         = getAIRegistry();
  const modules    = getModuleRegistry();
  const workflows  = getWorkflowRegistry();
  const database   = getDatabaseRegistry();
  const events     = getEventLog();
  const governance = getGovernanceDecisions();
  const deploy     = getDeployInfo();
  const arch       = getArchSummary();
  const apis       = scanAPIs();
  const traces     = getRecentTraces(10);
  const runtimeEvents = getRecentEvents(50);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    runtime,
    ai,
    apis:      { routes: apis, total: apis.length },
    modules,
    workflows,
    database,
    arch,
    deploy: {
      git:          deploy,
      environment:  process.env.NODE_ENV ?? "development",
      platform:     process.platform,
      node_version: process.version,
    },
    traces:         { recent: traces, total: traces.length },
    events,
    governance,
    runtime_events: runtimeEvents,
  });
}

/**
 * Real Inspection Pipeline Runtime (owner, 2026-08-06, Software Factory
 * Step 4). Editor Save / Terminal Run → real Inspection Record, evidence-
 * based, never fabricated. Reuses (never reimplements):
 *   - the real TypeScript compiler (SYNTAX_CHECK/IMPORT_CHECK parsing)
 *   - executionRuntime.ts's real startRun()/subscribeToRunEvents()
 *     (TYPE_DIAGNOSTIC — the registered "typecheck" command)
 *   - fsSecurity.ts's real resolveSafeRelativePath (every FILE-scope check)
 *   - executionRegistry.ts's real isCommandDenied (SECURITY_POLICY_CHECK
 *     for COMMAND-scope targets)
 *   - registry/module-registry.json + registry/factory-mapping.json
 *     (REGISTRY_CHECK)
 *   - registry/architecture-book.json (DEPENDENCY_CHECK)
 *   - registry/rule-coverage.json + registry/CONSTITUTION.json
 *     (GOVERNANCE_CHECK)
 * Inspection never writes to a source file, never cancels a Save, never
 * commits, never deploys — it only inspects and records evidence.
 */
import { readFileSync, existsSync } from "fs";
import { createHash, randomUUID } from "crypto";
import path from "path";
import * as ts from "typescript";
import { WORKSPACE_ROOT, resolveSafeRelativePath, IdeFsError } from "./fsSecurity";
import { isCommandDenied } from "./executionRegistry";
import { startRun, subscribeToRunEvents, cancelRun, type RunEvent } from "./executionRuntime";
import { getInspectionTypeDefinition, type InspectionType } from "./inspectionRegistry";
import { listRulesCitingFile } from "./governanceRuntime";

export type InspectionStatus = "QUEUED" | "RUNNING" | "PASSED" | "FAILED" | "WARNING" | "CANCELLED" | "TIMED_OUT" | "REJECTED" | "NOT_IMPLEMENTED";
export type Severity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface Finding {
  findingId: string;
  inspectionId: string;
  code: string;
  category: InspectionType;
  severity: Severity;
  message: string;
  file: string | null;
  line: number | null;
  column: number | null;
  endLine: number | null;
  endColumn: number | null;
  rule: string | null;
  evidence: string;
  blocking: boolean;
  source: string;
  createdAt: string;
  /** UI Inspection only (Step 6) — null for every other inspection type.
   * viewportProfileId/nodeId/selector/sourceMappingStatus/rect/
   * relatedNodeIds/overlapPixels/overlapRatio/contrastRatio/expectedValue/
   * actualValue/screenshotEvidence/artifactId — reuses this SAME Finding
   * contract, never a second Finding store. */
  uiMetadata: Record<string, unknown> | null;
}

export interface InspectionRecord {
  inspectionId: string;
  jobId: string | null;
  executionId: string | null;
  actor: string;
  ownerId: string;
  inspectionType: InspectionType;
  targetType: "file" | "command" | "url";
  targetPath: string;
  sourceHash: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  status: InspectionStatus;
  severity: Severity | null;
  blocking: boolean;
  findings: Finding[];
  findingCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  evidence: string;
  commandId: string | null;
  exitCode: number | null;
  stdoutHash: string | null;
  stderrHash: string | null;
  error: string | null;
}

export type InspectionEventType =
  | "INSPECTION_CREATED" | "INSPECTION_STARTED" | "INSPECTION_PASSED" | "INSPECTION_WARNING"
  | "INSPECTION_FAILED" | "INSPECTION_CANCELLED" | "INSPECTION_TIMED_OUT" | "INSPECTION_REJECTED";
export interface InspectionEvent {
  eventId: string; inspectionId: string; jobId: string | null; actor: string; timestamp: string;
  type: InspectionEventType; previousStatus: InspectionStatus; nextStatus: InspectionStatus; evidence: string;
}

export class InspectionError extends Error {
  code: "INSPECTION_TYPE_NOT_REGISTERED" | "INSPECTION_NOT_FOUND" | "INSPECTION_NOT_OWNED" | "NOT_IMPLEMENTED" | "INVALID_TARGET" | "INTERNAL_ERROR";
  constructor(code: typeof InspectionError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "InspectionError";
  }
}

interface InspectionState { record: InspectionRecord; events: InspectionEvent[] }
const inspections = new Map<string, InspectionState>();
const MAX_INSPECTION_HISTORY = 150;

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ---- Redaction (owner, 2026-08-06) — applied to every message/evidence
// string before it's ever stored, same static patterns Step 2's Execution
// Runtime already uses (never a second redaction implementation). ----
const REDACTION_PATTERNS: RegExp[] = [
  /Authorization:\s*Bearer\s+\S+/gi, /sk-[A-Za-z0-9_-]{10,}/g,
  /(api[_-]?key)\s*[:=]\s*['"]?[\w-]+/gi, /\btoken\s*=\s*\S+/gi, /\bsecret\s*=\s*\S+/gi, /\bpassword\s*=\s*\S+/gi,
];
function redact(text: string): string {
  let out = text;
  for (const p of REDACTION_PATTERNS) out = out.replace(p, "[REDACTED]");
  return out;
}

function newRecord(
  type: InspectionType, targetType: "file" | "command" | "url", targetPath: string, actor: string, ownerId: string,
  jobId: string | null, executionId: string | null
): InspectionState {
  const record: InspectionRecord = {
    inspectionId: randomUUID(), jobId, executionId, actor, ownerId, inspectionType: type, targetType, targetPath,
    sourceHash: null, startedAt: null, finishedAt: null, durationMs: null, status: "QUEUED", severity: null,
    blocking: false, findings: [], findingCount: 0, errorCount: 0, warningCount: 0, infoCount: 0,
    evidence: "", commandId: null, exitCode: null, stdoutHash: null, stderrHash: null, error: null,
  };
  const state: InspectionState = { record, events: [] };
  inspections.set(record.inspectionId, state);
  emitEvent(state, "INSPECTION_CREATED", "QUEUED", "QUEUED", "inspection record created");
  return state;
}

function emitEvent(state: InspectionState, type: InspectionEventType, prev: InspectionStatus, next: InspectionStatus, evidence: string) {
  state.events.push({
    eventId: randomUUID(), inspectionId: state.record.inspectionId, jobId: state.record.jobId,
    actor: state.record.actor, timestamp: new Date().toISOString(), type, previousStatus: prev, nextStatus: next, evidence: redact(evidence),
  });
}

function evictOldFinished(ownerId: string) {
  const isTerminal = (s: InspectionStatus) => s !== "QUEUED" && s !== "RUNNING";
  const finished = [...inspections.values()].filter((s) => s.record.ownerId === ownerId && isTerminal(s.record.status));
  const total = [...inspections.values()].filter((s) => s.record.ownerId === ownerId).length;
  const overflow = total - MAX_INSPECTION_HISTORY;
  for (let i = 0; i < Math.min(overflow, finished.length); i++) inspections.delete(finished[i].record.inspectionId);
}

function finalize(state: InspectionState, status: InspectionStatus, error: string | null) {
  const r = state.record;
  if (r.status !== "QUEUED" && r.status !== "RUNNING") return; // already terminal
  const prev = r.status;
  const finishedAt = new Date();
  r.status = status;
  r.finishedAt = finishedAt.toISOString();
  r.durationMs = r.startedAt ? finishedAt.getTime() - new Date(r.startedAt).getTime() : 0;
  r.error = error ? redact(error) : null;
  r.errorCount = r.findings.filter((f) => f.severity === "ERROR" || f.severity === "CRITICAL").length;
  r.warningCount = r.findings.filter((f) => f.severity === "WARNING").length;
  r.infoCount = r.findings.filter((f) => f.severity === "INFO").length;
  r.findingCount = r.findings.length;
  r.blocking = r.findings.some((f) => f.blocking);
  if (status === "PASSED" || status === "FAILED" || status === "WARNING") {
    r.severity = r.errorCount > 0 ? (r.findings.some((f) => f.severity === "CRITICAL") ? "CRITICAL" : "ERROR") : r.warningCount > 0 ? "WARNING" : "INFO";
  }
  const eventType: InspectionEventType =
    status === "PASSED" ? "INSPECTION_PASSED" : status === "WARNING" ? "INSPECTION_WARNING" :
    status === "CANCELLED" ? "INSPECTION_CANCELLED" : status === "TIMED_OUT" ? "INSPECTION_TIMED_OUT" :
    status === "REJECTED" || status === "NOT_IMPLEMENTED" ? "INSPECTION_REJECTED" : "INSPECTION_FAILED";
  emitEvent(state, eventType, prev, status, r.evidence || (error ?? "finalized"));
  evictOldFinished(r.ownerId);
}

function addFinding(state: InspectionState, f: Omit<Finding, "findingId" | "inspectionId" | "createdAt" | "uiMetadata"> & { uiMetadata?: Record<string, unknown> | null }) {
  state.record.findings.push({
    findingId: randomUUID(), inspectionId: state.record.inspectionId, createdAt: new Date().toISOString(),
    ...f, uiMetadata: f.uiMetadata ?? null, message: redact(f.message), evidence: redact(f.evidence),
  });
}

async function resolveTargetFile(clientPath: string): Promise<{ relPath: string; absPath: string; buf: Buffer }> {
  const { absPath, relPath } = await resolveSafeRelativePath(clientPath);
  const buf = readFileSync(absPath);
  return { relPath, absPath, buf };
}

// ============================================================
// SYNTAX_CHECK — real parser (ts.createSourceFile / JSON.parse)
// ============================================================
function scriptKindFor(ext: string): ts.ScriptKind | null {
  if (ext === ".ts") return ts.ScriptKind.TS;
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".js") return ts.ScriptKind.JS;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  return null;
}

export async function runSyntaxCheck(clientPath: string, actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("SYNTAX_CHECK")!;
  const state = newRecord("SYNTAX_CHECK", "file", clientPath, actor, ownerId, jobId, null);
  const record = state.record;
  try {
    const { relPath, buf } = await resolveTargetFile(clientPath);
    record.sourceHash = sha256Hex(buf);
    record.status = "RUNNING";
    record.startedAt = new Date().toISOString();
    emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", `parsing ${relPath}`);

    const ext = path.extname(relPath).toLowerCase();
    if (ext === ".json") {
      try {
        JSON.parse(buf.toString("utf-8"));
      } catch (e) {
        const m = /position (\d+)/.exec(e instanceof Error ? e.message : "");
        let line: number | null = null, column: number | null = null;
        if (m) {
          const offset = parseInt(m[1], 10);
          const text = buf.toString("utf-8").slice(0, offset);
          line = text.split("\n").length;
          column = offset - text.lastIndexOf("\n");
        }
        addFinding(state, {
          code: "JSON_PARSE_ERROR", category: "SYNTAX_CHECK", severity: "ERROR", message: (e instanceof Error ? e.message : null) ?? "malformed JSON",
          file: relPath, line, column, endLine: line, endColumn: column, rule: null,
          evidence: "JSON.parse() real thrown SyntaxError", blocking: def.blocking, source: def.implementation,
        });
      }
    } else {
      const kind = scriptKindFor(ext);
      if (kind === null) {
        record.evidence = `unsupported file type "${ext}" for SYNTAX_CHECK (allowed: ${def.allowedFileTypes?.join(", ")})`;
        finalize(state, "REJECTED", record.evidence);
        return record;
      }
      const source = ts.createSourceFile(relPath, buf.toString("utf-8"), ts.ScriptTarget.Latest, true, kind);
      const diagnostics = (source as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics;
      for (const d of diagnostics ?? []) {
        const pos = d.start !== undefined ? source.getLineAndCharacterOfPosition(d.start) : null;
        addFinding(state, {
          code: `TS${d.code}`, category: "SYNTAX_CHECK", severity: "ERROR",
          message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
          file: relPath, line: pos ? pos.line + 1 : null, column: pos ? pos.character + 1 : null,
          endLine: pos ? pos.line + 1 : null, endColumn: pos ? pos.character + 1 : null, rule: null,
          evidence: "ts.createSourceFile real parseDiagnostics", blocking: def.blocking, source: def.implementation,
        });
      }
    }
    record.evidence = `parsed ${relPath} via ${ext === ".json" ? "JSON.parse" : "ts.createSourceFile"}`;
    finalize(state, record.findings.length > 0 ? "FAILED" : "PASSED", null);
    return record;
  } catch (e) {
    const message = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    finalize(state, "REJECTED", message);
    return record;
  }
}

// ============================================================
// IMPORT_CHECK — real parse + real resolveSafeRelativePath per import
// ============================================================
export async function runImportCheck(clientPath: string, actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("IMPORT_CHECK")!;
  const state = newRecord("IMPORT_CHECK", "file", clientPath, actor, ownerId, jobId, null);
  const record = state.record;
  try {
    const { relPath, buf } = await resolveTargetFile(clientPath);
    record.sourceHash = sha256Hex(buf);
    record.status = "RUNNING";
    record.startedAt = new Date().toISOString();
    emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", `checking imports in ${relPath}`);

    const ext = path.extname(relPath).toLowerCase();
    const kind = scriptKindFor(ext);
    if (kind === null) {
      finalize(state, "REJECTED", `unsupported file type "${ext}" for IMPORT_CHECK`);
      return record;
    }
    const source = ts.createSourceFile(relPath, buf.toString("utf-8"), ts.ScriptTarget.Latest, true, kind);
    const specifiers: { specifier: string; line: number }[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
        specifiers.push({ specifier: node.moduleSpecifier.text, line: pos.line + 1 });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    const seen = new Map<string, number>();
    for (const { specifier, line } of specifiers) {
      const count = (seen.get(specifier) ?? 0) + 1;
      seen.set(specifier, count);
      if (count > 1) {
        addFinding(state, {
          code: "DUPLICATE_IMPORT", category: "IMPORT_CHECK", severity: "WARNING", message: `duplicate import of "${specifier}"`,
          file: relPath, line, column: null, endLine: line, endColumn: null, rule: null,
          evidence: "real parse — this specifier already appeared earlier in this file", blocking: false, source: def.implementation,
        });
      }
      if (!specifier.startsWith(".")) continue; // only relative imports are real evidence of a resolvable/traversable target this check can verify
      const importedFromDir = path.dirname(path.join(WORKSPACE_ROOT, relPath));
      const targetAbs = path.resolve(importedFromDir, specifier);
      const targetRelFromRoot = path.relative(WORKSPACE_ROOT, targetAbs);
      if (targetRelFromRoot.startsWith("..") || path.isAbsolute(targetRelFromRoot)) {
        addFinding(state, {
          code: "IMPORT_PATH_TRAVERSAL", category: "IMPORT_CHECK", severity: "ERROR", message: `relative import "${specifier}" resolves outside the workspace`,
          file: relPath, line, column: null, endLine: line, endColumn: null, rule: null,
          evidence: "resolved target escapes WORKSPACE_ROOT (same real check as resolveSafeRelativePath)", blocking: def.blocking, source: def.implementation,
        });
        continue;
      }
      const candidates = [targetAbs, `${targetAbs}.ts`, `${targetAbs}.tsx`, `${targetAbs}.js`, `${targetAbs}.jsx`, path.join(targetAbs, "index.ts"), path.join(targetAbs, "index.tsx")];
      if (!candidates.some((c) => existsSync(c))) {
        addFinding(state, {
          code: "UNRESOLVED_IMPORT", category: "IMPORT_CHECK", severity: "ERROR", message: `relative import "${specifier}" does not resolve to a real file`,
          file: relPath, line, column: null, endLine: line, endColumn: null, rule: null,
          evidence: `checked real fs.existsSync against ${candidates.length} real candidate paths`, blocking: def.blocking, source: def.implementation,
        });
      }
    }
    // Cross-boundary (Factory) import rules — no real Contract exists yet
    // for this (per instruction, not invented this phase); explicitly not
    // checked here rather than silently skipped.
    record.evidence = `parsed ${specifiers.length} import(s) in ${relPath} via ts.createSourceFile; relative targets checked against the real filesystem`;
    finalize(state, record.findings.some((f) => f.severity === "ERROR") ? "FAILED" : record.findings.length > 0 ? "WARNING" : "PASSED", null);
    return record;
  } catch (e) {
    const message = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    finalize(state, "REJECTED", message);
    return record;
  }
}

// ============================================================
// CONTRACT_CHECK — not implemented (no real generic validator exists)
// ============================================================
/** Generic NOT_IMPLEMENTED responder — used for ANY inspection type whose
 * registry entry is honestly NOT_IMPLEMENTED (CONTRACT_CHECK, and Step 6's
 * UI_LAYER_CHECK/UI_PERFORMANCE_CHECK), preserving the REAL requested type
 * rather than mislabeling every not-implemented result as CONTRACT_CHECK. */
async function runNotImplementedCheck(type: InspectionType, target: string, targetType: "file" | "command" | "url", actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const state = newRecord(type, targetType, target, actor, ownerId, jobId, null);
  state.record.evidence = `no real implementation exists for ${type} in this codebase — registered NOT_IMPLEMENTED, never a guessed result`;
  finalize(state, "NOT_IMPLEMENTED", null);
  return state.record;
}
export async function runContractCheck(clientPath: string, actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  return runNotImplementedCheck("CONTRACT_CHECK", clientPath, "file", actor, ownerId, jobId);
}

// ============================================================
// Browser Inspection bridge (Step 6) — the ONE real integration point that
// lets browserInspectionRuntime.ts create/finalize records in this SAME
// `inspections` Map (never a second Finding/Inspection store). The
// internal newRecord/finalize/addFinding/emitEvent primitives stay
// private to this module; this bridge is the only door in.
// ============================================================
export interface UiInspectionHandle {
  record: InspectionRecord;
  addUiFinding: (f: Omit<Finding, "findingId" | "inspectionId" | "createdAt" | "category">) => void;
  markStarted: (evidence: string) => void;
  finalizeUi: (status: InspectionStatus, error: string | null, evidence: string) => void;
}
export function createUiInspectionHandle(type: InspectionType, targetUrl: string, actor: string, ownerId: string, jobId: string | null): UiInspectionHandle {
  const state = newRecord(type, "url", targetUrl, actor, ownerId, jobId, null);
  return {
    record: state.record,
    markStarted: (evidence: string) => {
      state.record.status = "RUNNING";
      state.record.startedAt = new Date().toISOString();
      emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", evidence);
    },
    addUiFinding: (f) => addFinding(state, { ...f, category: type }),
    finalizeUi: (status: InspectionStatus, error: string | null, evidence: string) => {
      state.record.evidence = evidence;
      finalize(state, status, error);
    },
  };
}

// ============================================================
// REGISTRY_CHECK — reuses real module-registry.json + factory-mapping.json
// ============================================================
let cachedModuleRegistry: { modules: Record<string, { owner: string; purpose: string; purpose_th: string; status?: string }> } | null = null;
let cachedFactoryMapping: { modules: Record<string, { factoryOwner: string }> } | null = null;
function loadModuleRegistryFresh() {
  return JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/module-registry.json"), "utf-8"));
}
function loadFactoryMappingFresh() {
  try {
    return JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, "registry/factory-mapping.json"), "utf-8"));
  } catch {
    return null;
  }
}
export async function runRegistryCheck(clientPath: string, actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("REGISTRY_CHECK")!;
  const state = newRecord("REGISTRY_CHECK", "file", clientPath, actor, ownerId, jobId, null);
  const record = state.record;
  try {
    const { relPath, buf } = await resolveTargetFile(clientPath);
    record.sourceHash = sha256Hex(buf);
    record.status = "RUNNING";
    record.startedAt = new Date().toISOString();
    emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", `checking registry for ${relPath}`);

    cachedModuleRegistry = loadModuleRegistryFresh();
    cachedFactoryMapping = loadFactoryMappingFresh();
    const entry = cachedModuleRegistry!.modules[relPath];
    if (!entry) {
      addFinding(state, {
        code: "MODULE_NOT_REGISTERED", category: "REGISTRY_CHECK", severity: "WARNING", message: `${relPath} has no entry in registry/module-registry.json`,
        file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: null,
        evidence: "registry/module-registry.json real lookup — no key found", blocking: def.blocking, source: def.implementation,
      });
    } else {
      if (entry.purpose.startsWith("[Auto-detected]") || entry.status === "unregistered") {
        addFinding(state, {
          code: "MISSING_REAL_PURPOSE", category: "REGISTRY_CHECK", severity: "WARNING", message: `${relPath} has only an auto-stub purpose — never given a real description`,
          file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: "registry/module-registry.json real purpose field starts with \"[Auto-detected]\"", blocking: def.blocking, source: def.implementation,
        });
      }
      if (!entry.owner) {
        addFinding(state, {
          code: "INVALID_OWNER", category: "REGISTRY_CHECK", severity: "WARNING", message: `${relPath} has no real owner field`,
          file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: "registry/module-registry.json real owner field is empty", blocking: def.blocking, source: def.implementation,
        });
      }
    }
    if (!cachedFactoryMapping) {
      addFinding(state, {
        code: "FACTORY_MAPPING_UNAVAILABLE", category: "REGISTRY_CHECK", severity: "INFO", message: "registry/factory-mapping.json not found — run `npm run factory:build` to generate it",
        file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: null,
        evidence: "real fs read of registry/factory-mapping.json failed", blocking: false, source: def.implementation,
      });
    } else {
      const mapping = cachedFactoryMapping.modules[relPath];
      if (!mapping || mapping.factoryOwner === "UNKNOWN" || mapping.factoryOwner === "CONFLICT") {
        addFinding(state, {
          code: "UNKNOWN_FACTORY_MAPPING", category: "REGISTRY_CHECK", severity: "WARNING",
          message: mapping ? `${relPath}'s Factory mapping is ${mapping.factoryOwner}` : `${relPath} has no entry in registry/factory-mapping.json`,
          file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: "registry/factory-mapping.json real lookup", blocking: def.blocking, source: def.implementation,
        });
      }
    }
    record.evidence = `checked ${relPath} against registry/module-registry.json${cachedFactoryMapping ? " + registry/factory-mapping.json" : ""}`;
    finalize(state, record.findings.length > 0 ? "WARNING" : "PASSED", null);
    return record;
  } catch (e) {
    const message = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    finalize(state, "REJECTED", message);
    return record;
  }
}

// ============================================================
// DEPENDENCY_CHECK — reuses real architecture-book.json
// ============================================================
interface ArchBookNode {
  id: string; status?: string; internal_dependencies?: string[]; dependents?: string[];
  import_sites?: { specifier: string; line: number; resolved_target?: string | null }[];
}
export async function runDependencyCheck(clientPath: string, actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("DEPENDENCY_CHECK")!;
  const state = newRecord("DEPENDENCY_CHECK", "file", clientPath, actor, ownerId, jobId, null);
  const record = state.record;
  try {
    const { relPath, buf } = await resolveTargetFile(clientPath);
    record.sourceHash = sha256Hex(buf);
    record.status = "RUNNING";
    record.startedAt = new Date().toISOString();
    emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", `checking dependencies for ${relPath}`);

    const bookPath = path.join(WORKSPACE_ROOT, "registry/architecture-book.json");
    if (!existsSync(bookPath)) {
      record.evidence = "registry/architecture-book.json does not exist — run `npm run architecture:generate`";
      finalize(state, "REJECTED", record.evidence);
      return record;
    }
    const book = JSON.parse(readFileSync(bookPath, "utf-8")) as { nodes: ArchBookNode[]; generated_at: string };
    const node = book.nodes.find((n) => n.id === `module:${relPath}`);
    if (!node) {
      addFinding(state, {
        code: "NOT_IN_ARCHITECTURE_BOOK", category: "DEPENDENCY_CHECK", severity: "INFO",
        message: `${relPath} is not in the current registry/architecture-book.json snapshot (generated ${book.generated_at}) — the book is built separately via \`npm run architecture:generate\`, not on every save`,
        file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: null,
        evidence: "registry/architecture-book.json real node lookup — no match", blocking: false, source: def.implementation,
      });
    } else {
      if (node.status && node.status !== "OK") {
        addFinding(state, {
          code: "DEPENDENCY_STATUS_NOT_OK", category: "DEPENDENCY_CHECK", severity: "ERROR", message: `architecture book reports real status "${node.status}" for ${relPath}`,
          file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: `registry/architecture-book.json node.status = "${node.status}"`, blocking: def.blocking, source: def.implementation,
        });
      }
      for (const site of node.import_sites ?? []) {
        if (site.specifier.startsWith(".") === false && !site.resolved_target) {
          addFinding(state, {
            code: "UNRESOLVED_DEPENDENCY_TARGET", category: "DEPENDENCY_CHECK", severity: "WARNING",
            message: `architecture book could not resolve import "${site.specifier}" to a real internal module`,
            file: relPath, line: site.line, column: null, endLine: site.line, endColumn: null, rule: null,
            evidence: "registry/architecture-book.json real import_sites entry with resolved_target missing", blocking: false, source: def.implementation,
          });
        }
      }
      if ((node.dependents ?? []).length === 0 && !relPath.endsWith("route.ts") && !relPath.includes("/_lib/")) {
        addFinding(state, {
          code: "ORPHAN_MODULE", category: "DEPENDENCY_CHECK", severity: "INFO", message: `${relPath} has no real dependents recorded in the architecture book`,
          file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: "registry/architecture-book.json real node.dependents = []", blocking: false, source: def.implementation,
        });
      }
    }
    record.evidence = `checked ${relPath} against registry/architecture-book.json (generated ${book.generated_at})`;
    finalize(state, record.findings.some((f) => f.severity === "ERROR") ? "FAILED" : record.findings.length > 0 ? "WARNING" : "PASSED", null);
    return record;
  } catch (e) {
    const message = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    finalize(state, "REJECTED", message);
    return record;
  }
}

// ============================================================
// GOVERNANCE_CHECK — reuses real rule-coverage.json + CONSTITUTION.json
// ============================================================
export async function runGovernanceCheck(clientPath: string, actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("GOVERNANCE_CHECK")!;
  const state = newRecord("GOVERNANCE_CHECK", "file", clientPath, actor, ownerId, jobId, null);
  const record = state.record;
  try {
    const { relPath } = await resolveTargetFile(clientPath);
    record.status = "RUNNING";
    record.startedAt = new Date().toISOString();
    emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", `checking governance rules citing ${relPath}`);

    // Real Governance Runtime (Step 4.5) — the single, mechanically
    // computed classifier for every rule's status (ENFORCED/
    // DECLARED_NOT_ENFORCED/NOT_IMPLEMENTED/DEPRECATED/GHOST/UNKNOWN).
    // Never a second ad-hoc heuristic here — this used to guess "mechanical"
    // from a regex on rule.type; now it asks the one real source of truth.
    const citingRules = listRulesCitingFile(relPath);
    for (const r of citingRules) {
      const severity: Severity = r.status === "GHOST" || r.status === "NOT_IMPLEMENTED" ? "WARNING" : "INFO";
      const code =
        r.status === "ENFORCED" ? "GOVERNANCE_RULE_ENFORCED" :
        r.status === "GHOST" ? "GOVERNANCE_RULE_GHOST" :
        r.status === "NOT_IMPLEMENTED" ? "GOVERNANCE_RULE_NOT_IMPLEMENTED" :
        r.status === "DEPRECATED" ? "GOVERNANCE_RULE_DEPRECATED" :
        r.status === "UNKNOWN" ? "GOVERNANCE_RULE_UNKNOWN" :
        "GOVERNANCE_RULE_DECLARED_NOT_ENFORCED";
      addFinding(state, {
        code, category: "GOVERNANCE_CHECK", severity,
        message: `Rule ${r.ruleId} ("${r.title}") cites this file — status: ${r.status}`,
        file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: r.ruleId,
        evidence: `governanceRuntime.ts computeAllRules() real classification (source: ${r.source})`, blocking: false, source: def.implementation,
      });
    }
    if (citingRules.length === 0) {
      addFinding(state, {
        code: "NO_GOVERNANCE_RULE_CITES_FILE", category: "GOVERNANCE_CHECK", severity: "INFO", message: `no Constitution rule's enforced_by cites ${relPath}`,
        file: relPath, line: null, column: null, endLine: null, endColumn: null, rule: null,
        evidence: "governanceRuntime.ts real scan — no citation found", blocking: false, source: def.implementation,
      });
    }
    record.evidence = `scanned the real Governance Runtime for rules citing ${relPath} — ${citingRules.length} found`;
    finalize(state, "PASSED", null); // governance citations are informational — AI never judges pass/fail of a Constitution rule itself
    return record;
  } catch (e) {
    const message = e instanceof IdeFsError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
    finalize(state, "REJECTED", message);
    return record;
  }
}

// ============================================================
// FACTORY_COMPLETION_CHECK — reuses real factoryCompletionRuntime.ts
// (Step 10.5) — PROJECT scope, target ignored, never a second Factory
// Completion computation (same buildFactoryCompletionReport() the live
// /api/admin/ide/factory-completion route and report generator use).
// ============================================================
export async function runFactoryCompletionCheck(actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("FACTORY_COMPLETION_CHECK")!;
  const state = newRecord("FACTORY_COMPLETION_CHECK", "file", "FACTORY (PROJECT scope)", actor, ownerId, jobId, null);
  const record = state.record;
  try {
    record.status = "RUNNING";
    record.startedAt = new Date().toISOString();
    emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", "evaluating the real, live Factory Completion Report (PROJECT scope)");

    const { buildFactoryCompletionReport } = await import("./factoryCompletionRuntime");
    const report = buildFactoryCompletionReport();

    for (const g of report.completionGates) {
      if (!(g.blocking && (g.status === "BLOCKED" || g.status === "NOT_IMPLEMENTED" || g.status === "UNKNOWN"))) continue;
      const code =
        g.id === "VS_CODE_EXIT_READY" ? "VS_CODE_DEPENDENCY" :
        g.id === "DATA_ISOLATION_READY" ? "DATA_BOUNDARY_UNKNOWN" :
        g.id === "CAPABILITY_REUSE_READY" ? "CAPABILITY_DUPLICATE" :
        "FACTORY_INCOMPLETE";
      addFinding(state, {
        code, category: "FACTORY_COMPLETION_CHECK", severity: "WARNING",
        message: `Gate ${g.id} is ${g.status} — ${g.evidence.join("; ") || "no evidence recorded"}`,
        file: null, line: null, column: null, endLine: null, endColumn: null, rule: null,
        evidence: `factoryCompletionRuntime.ts#computeCompletionGates() — missing: ${g.missing.join(", ") || "none"}`,
        blocking: false, source: def.implementation,
      });
    }
    for (const s of report.systems) {
      if (s.status === "UI_ONLY") addFinding(state, { code: "UI_ONLY", category: "FACTORY_COMPLETION_CHECK", severity: "WARNING", message: `${s.name} is UI_ONLY — no real backing runtime confirmed`, file: null, line: null, column: null, endLine: null, endColumn: null, rule: null, evidence: `factoryCompletionRuntime.ts system ${s.id}`, blocking: false, source: def.implementation });
      if (s.status === "CONTRACT_ONLY") addFinding(state, { code: "CONTRACT_ONLY", category: "FACTORY_COMPLETION_CHECK", severity: "WARNING", message: `${s.name} is CONTRACT_ONLY — declared but not implemented`, file: null, line: null, column: null, endLine: null, endColumn: null, rule: null, evidence: `factoryCompletionRuntime.ts system ${s.id}`, blocking: false, source: def.implementation });
    }
    for (const p of report.nativeDNAEnforcement) {
      if (p.level === "MISSING") addFinding(state, { code: "NATIVE_DNA_MISSING", category: "FACTORY_COMPLETION_CHECK", severity: "INFO", message: `Principle "${p.principle}" has no real code/runtime enforcement`, file: null, line: null, column: null, endLine: null, endColumn: null, rule: null, evidence: p.evidence, blocking: false, source: def.implementation });
    }
    if (report.capabilityReuseReadiness.totalCapabilities > 0 && !report.capabilityReuseReadiness.resolverExists) {
      addFinding(state, { code: "CAPABILITY_DUPLICATE", category: "FACTORY_COMPLETION_CHECK", severity: "INFO", message: "No Capability Resolver exists — duplicate-capability detection is not yet automated", file: null, line: null, column: null, endLine: null, endColumn: null, rule: null, evidence: report.capabilityReuseReadiness.note, blocking: false, source: def.implementation });
    }
    addFinding(state, { code: "SOURCE_BOTTLENECK", category: "FACTORY_COMPLETION_CHECK", severity: "INFO", message: "Source Structure Bottleneck Audit (Phase 8) has no dedicated automated scorer yet — reported qualitatively in the Factory Completion Report narrative only", file: null, line: null, column: null, endLine: null, endColumn: null, rule: null, evidence: "no bottleneck-score field exists on FactoryCompletionReport", blocking: false, source: def.implementation });
    addFinding(state, { code: "COST_EVIDENCE_MISSING", category: "FACTORY_COMPLETION_CHECK", severity: "INFO", message: `COST_INTELLIGENCE_READY gate status: ${report.completionGates.find((g) => g.id === "COST_INTELLIGENCE_READY")?.status}`, file: null, line: null, column: null, endLine: null, endColumn: null, rule: null, evidence: "registry/infrastructure.json cost_summary field is the only real cost evidence source found", blocking: false, source: def.implementation });
    addFinding(state, { code: "OPERATIONAL_REALITY_GAP", category: "FACTORY_COMPLETION_CHECK", severity: "INFO", message: `${Object.entries(report.byStatus).filter(([k]) => k !== "COMPLETE" && k !== "OPERATIONAL").reduce((n, [, v]) => n + (v as number), 0)} of ${report.totalSystems} real systems are not yet COMPLETE/OPERATIONAL`, file: null, line: null, column: null, endLine: null, endColumn: null, rule: null, evidence: JSON.stringify(report.byStatus), blocking: false, source: def.implementation });

    record.evidence = `evaluated the real Factory Completion Report — ${report.totalSystems} systems, ${report.criticalBlockers.length} critical blockers, ${state.record.findings.length} finding(s)`;
    finalize(state, "PASSED", null); // an audit report is informational — never a build-blocking PASS/FAIL judgment
    return record;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finalize(state, "REJECTED", message);
    return record;
  }
}

// ============================================================
// GLOBAL_FACTORY_CHECK — reuses real globalFactoryRuntime.ts +
// deploymentRuntime.ts (Step 11) — PROJECT scope, target ignored, never a
// second Global Factory computation (same computeGlobalFactoryReport()
// the live /api/admin/ide/global-factory route and report generator use).
// ============================================================
export async function runGlobalFactoryCheck(actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("GLOBAL_FACTORY_CHECK")!;
  const state = newRecord("GLOBAL_FACTORY_CHECK", "file", "GLOBAL_FACTORY (PROJECT scope)", actor, ownerId, jobId, null);
  const record = state.record;
  try {
    record.status = "RUNNING";
    record.startedAt = new Date().toISOString();
    emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", "evaluating the real, live Global Factory Report (PROJECT scope)");

    const { computeGlobalFactoryReport } = await import("./globalFactoryRuntime");
    const report = computeGlobalFactoryReport();

    for (const d of report.domains) {
      if (d.status === "NOT_IMPLEMENTED" || d.status === "UNKNOWN") {
        const code =
          d.domain === "Deployment" ? "DEPLOYMENT" :
          d.domain === "Monitoring" ? "MONITORING" :
          d.domain === "Incident" ? "INCIDENT" :
          d.domain === "Recovery" ? "RECOVERY" :
          "GLOBAL_FACTORY";
        addFinding(state, {
          code, category: "GLOBAL_FACTORY_CHECK", severity: "WARNING",
          message: `Domain "${d.domain}" is ${d.status} — ${d.evidence}`,
          file: null, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: `globalFactoryRuntime.ts#computeGlobalFactoryReport() domain ${d.domain}`, blocking: false, source: def.implementation,
        });
      } else if (d.status === "PARTIAL") {
        const code =
          d.domain === "Monitoring" ? "MONITORING" :
          d.domain === "Incident" ? "INCIDENT" :
          d.domain === "Recovery" ? "RECOVERY" :
          "GLOBAL_FACTORY";
        addFinding(state, {
          code, category: "GLOBAL_FACTORY_CHECK", severity: "INFO",
          message: `Domain "${d.domain}" is PARTIAL — ${d.evidence}`,
          file: null, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: `globalFactoryRuntime.ts#computeGlobalFactoryReport() domain ${d.domain}`, blocking: false, source: def.implementation,
        });
      }
    }

    const { computeRuntimeDependencyGraph } = await import("./globalFactoryRuntime");
    const graph = computeRuntimeDependencyGraph();
    const notImplementedNodes = graph.nodes.filter((n) => n.status === "NOT_IMPLEMENTED");
    if (notImplementedNodes.length > 0) {
      addFinding(state, {
        code: "RUNTIME_DEPENDENCY", category: "GLOBAL_FACTORY_CHECK", severity: "INFO",
        message: `${notImplementedNodes.length} real Runtime node(s) are NOT_IMPLEMENTED: ${notImplementedNodes.map((n) => n.id).join(", ")}`,
        file: null, line: null, column: null, endLine: null, endColumn: null, rule: null,
        evidence: "globalFactoryRuntime.ts#computeRuntimeDependencyGraph() — mechanically computed from real import statements", blocking: false, source: def.implementation,
      });
    }

    const { computeFactoryRuntimeReport } = await import("./globalFactoryRuntime");
    const factoryRuntimeReport = computeFactoryRuntimeReport();
    const unreached = factoryRuntimeReport.reachedSubRuntimes.filter((r) => !r.reached);
    if (unreached.length > 0) {
      addFinding(state, {
        code: "FACTORY_RUNTIME", category: "GLOBAL_FACTORY_CHECK", severity: "INFO",
        message: `${unreached.length} real sub-Runtime(s) not reached: ${unreached.map((r) => r.id).join(", ")}`,
        file: null, line: null, column: null, endLine: null, endColumn: null, rule: null,
        evidence: "globalFactoryRuntime.ts#computeFactoryRuntimeReport()", blocking: false, source: def.implementation,
      });
    }

    record.evidence = `evaluated the real Global Factory Report — ${report.domains.length} domains, ${state.record.findings.length} finding(s)`;
    finalize(state, "PASSED", null); // an audit report is informational — never a build-blocking PASS/FAIL judgment
    return record;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finalize(state, "REJECTED", message);
    return record;
  }
}

// ============================================================
// OPERATIONS_CHECK — reuses real monitoringRuntime.ts/incidentRuntime.ts/
// recoveryRuntime.ts (Step 12) — PROJECT scope, target ignored, never a
// second Operations computation.
// ============================================================
export async function runOperationsCheck(actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("OPERATIONS_CHECK")!;
  const state = newRecord("OPERATIONS_CHECK", "file", "OPERATIONS (PROJECT scope)", actor, ownerId, jobId, null);
  const record = state.record;
  try {
    record.status = "RUNNING";
    record.startedAt = new Date().toISOString();
    emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", "evaluating the real, live Operations state (PROJECT scope)");

    const finding = (code: string, message: string, evidence: string, severity: Severity = "INFO") =>
      addFinding(state, { code, category: "OPERATIONS_CHECK", severity, message, file: null, line: null, column: null, endLine: null, endColumn: null, rule: null, evidence, blocking: false, source: def.implementation });

    const { listSignals, computeMonitoringSummary } = await import("./monitoringRuntime");
    const { listIncidents } = await import("./incidentRuntime");
    const { listRecoveryPlans } = await import("./recoveryRuntime");

    const summary = computeMonitoringSummary(ownerId);
    const signals = listSignals(ownerId);
    if (signals.length === 0) {
      finding("MONITORING_MISSING", "no real Signal has been collected yet for this owner — Monitoring has not run", "monitoringRuntime.ts#listSignals returned 0 records", "INFO");
    }
    for (const s of signals) {
      if (s.status === "STALE") finding("SIGNAL_STALE", `Signal ${s.signalType} is STALE — ${s.reason}`, `monitoringRuntime.ts signal ${s.signalId}`, "INFO");
      if (s.status === "UNHEALTHY") finding("RUNTIME_UNHEALTHY", `Signal ${s.signalType} is UNHEALTHY — ${s.reason}`, `monitoringRuntime.ts signal ${s.signalId}`, "INFO");
      if (s.status === "UNKNOWN" && (s.signalType === "EXTERNAL_PROVIDER_HEALTH" || s.signalType === "DATABASE_HEALTH" || s.signalType === "CONNECTOR_HEALTH")) {
        finding("PROVIDER_HEALTH_UNKNOWN", `Provider-related Signal ${s.signalType} is honestly UNKNOWN — ${s.reason}`, `monitoringRuntime.ts signal ${s.signalId}`, "INFO");
      }
      if (s.signalType === "BACKUP_HEALTH" && s.status !== "HEALTHY") {
        finding("BACKUP_NOT_VERIFIED", `Backup is not confirmed ready to recover — ${s.reason}`, `monitoringRuntime.ts signal ${s.signalId}`, "INFO");
      }
    }

    const incidents = listIncidents(ownerId);
    const openIncidents = incidents.filter((i) => !["RESOLVED", "FALSE_POSITIVE"].includes(i.status));
    for (const inc of openIncidents) {
      finding("INCIDENT_OPEN", `Incident ${inc.type} is ${inc.status} (${inc.severity}) — ${inc.title}`, `incidentRuntime.ts incident ${inc.incidentId}`, "INFO");
      if (inc.severity === "CRITICAL" || inc.severity === "HIGH") finding("CRITICAL_INCIDENT", `Critical/High Incident ${inc.type} is open — ${inc.title}`, `incidentRuntime.ts incident ${inc.incidentId}`, "WARNING");
      if (inc.affectedDependencies.length > 0) finding("DEPENDENCY_IMPACT", `Incident ${inc.incidentId} has ${inc.affectedDependencies.length} real affected dependent Runtime(s): ${inc.affectedDependencies.join(", ")}`, `incidentRuntime.ts incident ${inc.incidentId} affectedDependencies`, "INFO");
      if (inc.evidence.length === 0) finding("OPERATIONS_EVIDENCE_MISSING", `Incident ${inc.incidentId} has no real evidence attached yet`, `incidentRuntime.ts incident ${inc.incidentId}`, "INFO");
    }

    const plans = listRecoveryPlans(ownerId);
    for (const p of plans) {
      if (p.executionStatus === "BLOCKED") finding("RECOVERY_BLOCKED", `Recovery Plan ${p.recoveryType} is BLOCKED — ${p.limitations}`, `recoveryRuntime.ts plan ${p.recoveryPlanId}`, "INFO");
      if (p.verification && p.verification.status !== "VERIFIED") finding("RECOVERY_UNVERIFIED", `Recovery Plan ${p.recoveryType} verification is ${p.verification.status} — ${p.verification.reason}`, `recoveryRuntime.ts plan ${p.recoveryPlanId}`, "INFO");
    }

    // ── Step 12.5: Continuous Operations / Alerting / Backup / Restore Test ──
    const { listLoopRuns } = await import("./continuousOperationsRuntime");
    const { getSchedulerContractStatus } = await import("./continuousOperationsRegistry");
    const { listAlerts } = await import("./alertRuntime");
    const { discoverBackups } = await import("./backupRuntime");
    const { listRestoreTests } = await import("./restoreTestRuntime");

    const loopRuns = listLoopRuns(ownerId);
    if (loopRuns.length === 0) finding("MONITORING_LOOP_MISSING", "no real Operations Loop run has ever executed for this owner", "continuousOperationsRuntime.ts#listLoopRuns returned 0 records", "INFO");
    const scheduler = getSchedulerContractStatus();
    if (scheduler.adapter !== "IMPLEMENTED") finding("MONITORING_SCHEDULE_NOT_ACTIVE", `real Scheduler Adapter is ${scheduler.adapter} — no real, live proof a scheduled run has ever fired`, "continuousOperationsRegistry.ts#getSchedulerContractStatus", "INFO");

    const alerts = listAlerts(ownerId);
    for (const a of alerts) {
      if (a.status === "FAILED") finding("ALERT_DISPATCH_FAILED", `Alert ${a.title} FAILED to dispatch on every real channel`, `alertRuntime.ts alert ${a.alertId}`, "INFO");
      if (a.status === "DISPATCHED") finding("ALERT_DELIVERY_UNKNOWN", `Alert ${a.title} is DISPATCHED — no real delivery receipt exists to confirm DELIVERED`, `alertRuntime.ts alert ${a.alertId}`, "INFO");
    }

    const backups = discoverBackups();
    if (backups.length === 0) finding("BACKUP_MISSING", "no real backup exists anywhere in backups/", "backupRuntime.ts#discoverBackups returned 0 records", "WARNING");
    else {
      const { verifyBackupIntegrity } = await import("./backupRuntime");
      const latestReport = await verifyBackupIntegrity(backups[0].backupId, ownerId, actor);
      if (latestReport.status === "STALE") finding("BACKUP_STALE", `latest real backup ${backups[0].backupId} is STALE — ${latestReport.reason}`, `backupRuntime.ts integrity report for ${backups[0].backupId}`, "INFO");
      if (latestReport.status === "PARTIAL") finding("BACKUP_PARTIAL", `latest real backup ${backups[0].backupId} is PARTIAL — ${latestReport.reason}`, `backupRuntime.ts integrity report for ${backups[0].backupId}`, "INFO");
      if (latestReport.status === "CORRUPT") finding("BACKUP_CORRUPT", `latest real backup ${backups[0].backupId} is CORRUPT — ${latestReport.reason}`, `backupRuntime.ts integrity report for ${backups[0].backupId}`, "WARNING");
    }
    const restoreTests = listRestoreTests(ownerId);
    if (restoreTests.length === 0) finding("RESTORE_TEST_MISSING", "no real Restore Test has ever run for this owner", "restoreTestRuntime.ts#listRestoreTests returned 0 records", "INFO");
    for (const r of restoreTests) {
      finding("RESTORE_UNVERIFIED", `Restore Test for backup ${r.backupId} is ${r.status} — never claims VERIFIED_RESTORE (no isolated database target exists)`, `restoreTestRuntime.ts run ${r.restoreTestId}`, "INFO");
      const cleanupStage = r.stages.find((s) => s.stage === "CLEANUP");
      if (cleanupStage && cleanupStage.cleanupStatus !== "CLEAN") finding("RESTORE_CLEANUP_FAILED", `Restore Test ${r.restoreTestId}'s CLEANUP stage did not confirm CLEAN`, `restoreTestRuntime.ts run ${r.restoreTestId}`, "WARNING");
    }

    const { computeCompletionGates } = await import("./factoryCompletionRuntime");
    const opsGates = computeCompletionGates().filter((g) => ["MONITORING_READY", "INCIDENT_RECOVERY_READY", "BACKUP_READY"].includes(g.id));
    for (const g of opsGates) {
      if (g.blocking && (g.status === "BLOCKED" || g.status === "NOT_IMPLEMENTED")) finding("OPERATIONS_READINESS_BLOCKED", `Gate ${g.id} is ${g.status}`, `factoryCompletionRuntime.ts gate ${g.id}`, "WARNING");
    }

    record.evidence = `evaluated the real, live Operations state — ${summary.total} signals, ${openIncidents.length} open incidents, ${plans.length} recovery plans, ${alerts.length} alerts, ${backups.length} backups, ${restoreTests.length} restore tests, ${state.record.findings.length} finding(s)`;
    finalize(state, "PASSED", null); // an audit report is informational — never a build-blocking PASS/FAIL judgment
    return record;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finalize(state, "REJECTED", message);
    return record;
  }
}

// ============================================================
// FACTORY_WORKSPACE_CHECK — reuses real factoryWorkspaceRuntime.ts and its
// Step 13 dependencies (intent/capabilityResolver/contextPlanner/
// executionPlan/aiContext/workerRegistry) — PROJECT scope, target ignored,
// never a second Factory Workspace computation.
// ============================================================
export async function runFactoryWorkspaceCheck(actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("FACTORY_WORKSPACE_CHECK")!;
  const state = newRecord("FACTORY_WORKSPACE_CHECK", "file", "FACTORY_WORKSPACE (PROJECT scope)", actor, ownerId, jobId, null);
  const record = state.record;
  try {
    record.status = "RUNNING";
    record.startedAt = new Date().toISOString();
    emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", "evaluating the real, live Factory Workspace state (PROJECT scope)");

    const finding = (code: string, message: string, evidence: string, severity: Severity = "INFO") =>
      addFinding(state, { code, category: "FACTORY_WORKSPACE_CHECK", severity, message, file: null, line: null, column: null, endLine: null, endColumn: null, rule: null, evidence, blocking: false, source: def.implementation });

    const { listWorkspaceSessions } = await import("./factoryWorkspaceRuntime");
    const { listWorkers } = await import("./workerRegistry");

    const sessions = listWorkspaceSessions(ownerId);
    if (sessions.length === 0) {
      finding("NATIVE_FACTORY_FLOW_FAILURE", "no real Workspace Session has ever been created for this owner", "factoryWorkspaceRuntime.ts#listWorkspaceSessions returned 0 records", "INFO");
    }
    for (const s of sessions) {
      if (!s.intentId) finding("INTENT_INCOMPLETE", `Workspace Session ${s.workspaceSessionId} has no real Intent attached yet`, `factoryWorkspaceRuntime.ts session ${s.workspaceSessionId}`, "INFO");
      if (s.capabilityResolution) {
        if (s.capabilityResolution.overallClass === "NEW_CAPABILITY_REQUIRED") finding("CAPABILITY_NOT_FOUND", `Workspace Session ${s.workspaceSessionId}: no real Capability matched — ${s.capabilityResolution.missing.join("; ")}`, `capabilityResolverRuntime.ts report for session ${s.workspaceSessionId}`, "INFO");
        if (s.capabilityResolution.overallClass === "BLOCKED") finding("CAPABILITY_CONFLICT", `Workspace Session ${s.workspaceSessionId}: real Capability Resolution is BLOCKED`, `capabilityResolverRuntime.ts report for session ${s.workspaceSessionId}`, "INFO");
      }
      if (s.status === "BLOCKED") {
        finding("EXECUTION_PLAN_BLOCKED", `Workspace Session ${s.workspaceSessionId} is BLOCKED — ${s.blockers.join("; ")}`, `factoryWorkspaceRuntime.ts session ${s.workspaceSessionId}`, "WARNING");
      }
      const pendingGates = s.ownerDecisions.filter((d) => d.decision === "PENDING");
      if (s.status === "AWAITING_OWNER" || pendingGates.length > 0) {
        finding("OWNER_DECISION_REQUIRED", `Workspace Session ${s.workspaceSessionId} requires a real Owner Decision to proceed`, `factoryWorkspaceRuntime.ts session ${s.workspaceSessionId}`, "WARNING");
      }
      if (s.aiContextPackageIds.length === 0 && s.status !== "DRAFT" && s.status !== "ANALYZING" && s.status !== "CAPABILITY_MATCHING") {
        finding("WORKER_UNAVAILABLE", `Workspace Session ${s.workspaceSessionId} has not yet had a real Worker assigned`, `factoryWorkspaceRuntime.ts session ${s.workspaceSessionId}`, "INFO");
      }
      if (s.status === "COMPLETED" && s.resultReport && (s.resultReport.status === "PARTIAL" || s.resultReport.status === "UNVERIFIED")) {
        finding("OUTCOME_UNVERIFIED", `Workspace Session ${s.workspaceSessionId}'s real Outcome Report is ${s.resultReport.status} — not OUTCOME_PROVEN`, `factoryWorkspaceRuntime.ts session ${s.workspaceSessionId} resultReport`, "INFO");
      }
    }

    if (sessions.length > 0) {
      const { listContextPlans } = await import("./contextPlannerRuntime");
      const contextPlans = listContextPlans(ownerId);
      for (const cp of contextPlans) {
        if (cp.excludedFiles.some((f) => f.reason.includes("MAX_INCLUDED_FILES"))) finding("CONTEXT_SCOPE_TOO_BROAD", `Context Plan ${cp.contextPlanId} hit the real MAX_INCLUDED_FILES scope guard`, `contextPlannerRuntime.ts plan ${cp.contextPlanId}`, "INFO");
        if (cp.requiredEvidence.length === 0) finding("CONTEXT_EVIDENCE_MISSING", `Context Plan ${cp.contextPlanId} declares no real requiredEvidence`, `contextPlannerRuntime.ts plan ${cp.contextPlanId}`, "INFO");
      }
    }

    const workers = listWorkers();
    const unavailable = workers.filter((w) => w.status === "NOT_IMPLEMENTED" || w.availability === "UNAVAILABLE");
    for (const w of unavailable) finding("WORKER_CAPABILITY_MISMATCH", `real Worker "${w.id}" is ${w.status}/${w.availability} in the Worker Registry`, `workerRegistry.ts#WORKER_REGISTRY.${w.id}`, "INFO");

    record.evidence = `evaluated the real, live Factory Workspace state — ${sessions.length} Workspace Session(s), ${workers.length} registered Worker(s), ${state.record.findings.length} finding(s)`;
    finalize(state, "PASSED", null); // an audit report is informational — never a build-blocking PASS/FAIL judgment
    return record;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finalize(state, "REJECTED", message);
    return record;
  }
}

// ============================================================
// SECURITY_POLICY_CHECK — reuses real fsSecurity/executionRegistry checks
// ============================================================
export async function runSecurityPolicyCheck(
  target: string, targetType: "file" | "command", actor: string, ownerId: string, jobId: string | null
): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("SECURITY_POLICY_CHECK")!;
  const state = newRecord("SECURITY_POLICY_CHECK", targetType, target, actor, ownerId, jobId, null);
  const record = state.record;
  record.status = "RUNNING";
  record.startedAt = new Date().toISOString();
  emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", `checking security policy for ${target}`);

  if (targetType === "command") {
    const parts = target.split(" ");
    const denyCheck = isCommandDenied(parts[0], parts.slice(1));
    if (denyCheck.denied) {
      addFinding(state, {
        code: "COMMAND_DENIED", category: "SECURITY_POLICY_CHECK", severity: "CRITICAL", message: denyCheck.reason ?? "command denied by policy",
        file: null, line: null, column: null, endLine: null, endColumn: null, rule: null,
        evidence: "executionRegistry.ts's real isCommandDenied()", blocking: def.blocking, source: def.implementation,
      });
    }
    record.evidence = `checked command "${target}" via the real isCommandDenied()`;
    finalize(state, record.findings.length > 0 ? "FAILED" : "PASSED", null);
    return record;
  }

  try {
    const { relPath } = await resolveTargetFile(target);
    record.sourceHash = null;
    record.evidence = `resolveSafeRelativePath("${target}") succeeded — no traversal/symlink/excluded-path violation (real path: ${relPath})`;
    finalize(state, "PASSED", null);
    return record;
  } catch (e) {
    if (e instanceof IdeFsError) {
      addFinding(state, {
        code: `SECURITY_${e.code}`, category: "SECURITY_POLICY_CHECK", severity: "CRITICAL", message: e.message,
        file: target, line: null, column: null, endLine: null, endColumn: null, rule: null,
        evidence: "fsSecurity.ts's real resolveSafeRelativePath() threw", blocking: def.blocking, source: def.implementation,
      });
      finalize(state, "FAILED", null);
      return record;
    }
    finalize(state, "REJECTED", e instanceof Error ? e.message : String(e));
    return record;
  }
}

// ============================================================
// TYPE_DIAGNOSTIC — reuses the real Execution Runtime's "typecheck" run
// ============================================================
const TSC_DIAGNOSTIC_LINE = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/;

export async function runTypeDiagnostic(clientPath: string, actor: string, ownerId: string, jobId: string | null): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition("TYPE_DIAGNOSTIC")!;
  const state = newRecord("TYPE_DIAGNOSTIC", "file", clientPath, actor, ownerId, jobId, null);
  const record = state.record;
  try {
    const { relPath, buf } = await resolveTargetFile(clientPath);
    record.sourceHash = sha256Hex(buf);
  } catch { /* target may not exist as a real file — typecheck still runs project-wide */ }

  record.status = "RUNNING";
  record.startedAt = new Date().toISOString();
  emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", "running the real \"typecheck\" command (PROJECT scope)");
  record.commandId = "typecheck";

  return new Promise<InspectionRecord>((resolve) => {
    let run;
    try {
      run = startRun("typecheck", undefined, ownerId, { actor });
    } catch (e) {
      finalize(state, "REJECTED", e instanceof Error ? e.message : String(e));
      resolve(record);
      return;
    }
    record.executionId = run.runId;
    let stdout = "";
    let settled = false;
    const terminalTypes = ["run.completed", "run.failed", "run.cancelled", "run.timeout", "run.output_limited"];
    const handle = (event: RunEvent) => {
      if (settled) return;
      if (event.type === "run.stdout" || event.type === "run.stderr") stdout += event.text ?? "";
      if (!terminalTypes.includes(event.type)) return;
      settled = true;
      record.stdoutHash = sha256Hex(stdout);
      record.stderrHash = sha256Hex("");
      record.exitCode = event.type === "run.completed" ? 0 : 1;
      const lines = stdout.split("\n");
      for (const line of lines) {
        const m = TSC_DIAGNOSTIC_LINE.exec(line.trim());
        if (!m) continue;
        const [, file, lineNo, col, sev, code, message] = m;
        const isTarget = clientPath ? file.replace(/\\/g, "/").endsWith(clientPath.replace(/\\/g, "/")) : false;
        addFinding(state, {
          code, category: "TYPE_DIAGNOSTIC", severity: sev === "error" ? "ERROR" : "WARNING", message,
          file, line: parseInt(lineNo, 10), column: parseInt(col, 10), endLine: parseInt(lineNo, 10), endColumn: parseInt(col, 10),
          rule: null, evidence: `real tsc diagnostic (scope: PROJECT)${isTarget ? " — matches the requested target file" : " — a different file in the same project-wide run"}`,
          blocking: def.blocking, source: def.implementation,
        });
      }
      record.evidence = `real \`npx tsc --noEmit\` run ${run.runId}, PROJECT scope, ${record.findings.length} diagnostic(s) parsed from real stdout`;
      if (event.type === "run.cancelled") finalize(state, "CANCELLED", null);
      else if (event.type === "run.timeout") finalize(state, "TIMED_OUT", null);
      else finalize(state, record.findings.some((f) => f.severity === "ERROR") ? "FAILED" : "PASSED", null);
      resolve(record);
    };
    const sub = subscribeToRunEvents(run.runId, handle);
    // The run may already be fully terminal by the time we subscribe (e.g.
    // a synchronous PROCESS_START_FAILED before any listener existed) — its
    // events are only in `replay`, never delivered live, so replay them
    // through the same handler rather than hanging forever.
    if (sub) for (const event of sub.replay) handle(event);
  });
}

// ============================================================
// RUN_COMMAND pipeline trigger — converts an ALREADY-RUNNING execution's
// real output into an Inspection Record. Never spawns a second process:
// subscribes to the SAME runId the RUN_COMMAND job already started.
// ============================================================
const RUN_COMMAND_INSPECTION_MAP: Record<string, InspectionType> = {
  typecheck: "TYPE_DIAGNOSTIC",
  governance: "GOVERNANCE_CHECK",
  "architecture.check": "DEPENDENCY_CHECK",
};

export function inspectionTypeForCommand(commandId: string): InspectionType | null {
  return RUN_COMMAND_INSPECTION_MAP[commandId] ?? null;
}

/** A line real command output uses to flag a real problem — never invented,
 * only recognized from the actual tool's own real reporting conventions
 * (❌/FAIL/ERROR prefixes used by scripts/governance.sh,
 * scripts/check-system-control-graph.ts, and npx tsc's own error lines). */
const COMMAND_FAILURE_LINE = /(❌|FAIL(ED)?[:\s]|ERROR[:\s]|error TS\d+)/i;

export function attachInspectionToRun(
  commandId: string, executionId: string, actor: string, ownerId: string, jobId: string | null
): InspectionRecord | null {
  const type = inspectionTypeForCommand(commandId);
  if (!type) return null;
  const def = getInspectionTypeDefinition(type)!;
  const state = newRecord(type, "command", commandId, actor, ownerId, jobId, executionId);
  const record = state.record;
  record.status = "RUNNING";
  record.startedAt = new Date().toISOString();
  record.commandId = commandId;
  emitEvent(state, "INSPECTION_STARTED", "QUEUED", "RUNNING", `attached to already-running execution ${executionId} (command "${commandId}") — no second process spawned`);

  if (type === "TYPE_DIAGNOSTIC") {
    // Real tsc diagnostics need the same file/line/column parse as
    // runTypeDiagnostic — reuse it by attaching to the SAME executionId
    // rather than duplicating the parse logic inline here.
  }

  let stdout = "";
  let settled = false;
  const terminalTypes = ["run.completed", "run.failed", "run.cancelled", "run.timeout", "run.output_limited"];
  const handle = (event: RunEvent) => {
    if (settled) return;
    if (event.type === "run.stdout" || event.type === "run.stderr") stdout += event.text ?? "";
    if (!terminalTypes.includes(event.type)) return;
    settled = true;
    record.stdoutHash = sha256Hex(stdout);
    record.exitCode = event.type === "run.completed" ? 0 : 1;
    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    if (type === "TYPE_DIAGNOSTIC") {
      for (const line of lines) {
        const m = TSC_DIAGNOSTIC_LINE.exec(line.trim());
        if (!m) continue;
        const [, file, lineNo, col, sev, code, message] = m;
        addFinding(state, {
          code, category: "TYPE_DIAGNOSTIC", severity: sev === "error" ? "ERROR" : "WARNING", message,
          file, line: parseInt(lineNo, 10), column: parseInt(col, 10), endLine: parseInt(lineNo, 10), endColumn: parseInt(col, 10),
          rule: null, evidence: `real tsc diagnostic from RUN_COMMAND execution ${executionId} (scope: PROJECT)`,
          blocking: def.blocking, source: def.implementation,
        });
      }
    } else {
      for (const line of lines) {
        if (!COMMAND_FAILURE_LINE.test(line)) continue;
        addFinding(state, {
          code: `${commandId.toUpperCase()}_REPORTED_FAILURE`, category: type, severity: "ERROR", message: line.trim(),
          file: null, line: null, column: null, endLine: null, endColumn: null, rule: null,
          evidence: `real stdout/stderr line from RUN_COMMAND execution ${executionId} ("${commandId}")`, blocking: def.blocking, source: def.implementation,
        });
      }
    }
    record.evidence = `attached to real execution ${executionId} ("${commandId}"), exit handling: ${event.type}, ${record.findings.length} finding(s) parsed from real output`;
    if (event.type === "run.cancelled") finalize(state, "CANCELLED", null);
    else if (event.type === "run.timeout") finalize(state, "TIMED_OUT", null);
    else if (record.exitCode === 0 && record.findings.length === 0) finalize(state, "PASSED", null);
    else finalize(state, record.findings.length > 0 ? "FAILED" : "WARNING", null);
  };
  const sub = subscribeToRunEvents(executionId, handle);
  if (!sub) {
    finalize(state, "REJECTED", `no run with id ${executionId} to attach to`);
    return record;
  }
  for (const event of sub.replay) handle(event);
  return record;
}

// ============================================================
// Dispatcher + store accessors
// ============================================================
export async function createInspection(
  type: InspectionType, target: string, actor: string, ownerId: string,
  options?: { jobId?: string | null; executionId?: string | null }
): Promise<InspectionRecord> {
  const def = getInspectionTypeDefinition(type);
  if (!def) throw new InspectionError("INSPECTION_TYPE_NOT_REGISTERED", `unknown inspection type: ${type}`);
  if (def.status === "NOT_IMPLEMENTED") return runNotImplementedCheck(type, target, def.scope === "URL" ? "url" : "file", actor, ownerId, options?.jobId ?? null);

  switch (type) {
    case "SYNTAX_CHECK": return runSyntaxCheck(target, actor, ownerId, options?.jobId ?? null);
    case "IMPORT_CHECK": return runImportCheck(target, actor, ownerId, options?.jobId ?? null);
    case "REGISTRY_CHECK": return runRegistryCheck(target, actor, ownerId, options?.jobId ?? null);
    case "DEPENDENCY_CHECK": return runDependencyCheck(target, actor, ownerId, options?.jobId ?? null);
    case "GOVERNANCE_CHECK": return runGovernanceCheck(target, actor, ownerId, options?.jobId ?? null);
    case "FACTORY_COMPLETION_CHECK": return runFactoryCompletionCheck(actor, ownerId, options?.jobId ?? null);
    case "GLOBAL_FACTORY_CHECK": return runGlobalFactoryCheck(actor, ownerId, options?.jobId ?? null);
    case "OPERATIONS_CHECK": return runOperationsCheck(actor, ownerId, options?.jobId ?? null);
    case "FACTORY_WORKSPACE_CHECK": return runFactoryWorkspaceCheck(actor, ownerId, options?.jobId ?? null);
    case "SECURITY_POLICY_CHECK": return runSecurityPolicyCheck(target, "file", actor, ownerId, options?.jobId ?? null);
    case "TYPE_DIAGNOSTIC": return runTypeDiagnostic(target, actor, ownerId, options?.jobId ?? null);
    case "CONTRACT_CHECK": return runContractCheck(target, actor, ownerId, options?.jobId ?? null);
    case "UI_DOM_STRUCTURE_CHECK": case "UI_LAYOUT_CHECK": case "UI_OVERFLOW_CHECK": case "UI_OVERLAP_CHECK":
    case "UI_RESPONSIVE_CHECK": case "UI_TEXT_RENDER_CHECK": case "UI_COLOR_CONTRAST_CHECK":
    case "UI_INTERACTIVE_TARGET_CHECK": case "UI_ACCESSIBILITY_CHECK": case "UI_RESOURCE_CHECK":
    case "UI_LAYER_CHECK": case "UI_PERFORMANCE_CHECK":
      throw new InspectionError("INVALID_TARGET", `${type} runs through the Browser Inspection Runtime (POST /api/admin/ide/ui-inspection/run), not the generic file/command Inspection dispatcher`);
    default: throw new InspectionError("INSPECTION_TYPE_NOT_REGISTERED", `unhandled inspection type: ${type}`);
  }
}

export function getInspection(inspectionId: string, ownerId: string): InspectionRecord {
  const state = inspections.get(inspectionId);
  if (!state) throw new InspectionError("INSPECTION_NOT_FOUND", "no inspection with that id");
  if (state.record.ownerId !== ownerId) throw new InspectionError("INSPECTION_NOT_OWNED", "this inspection belongs to a different session");
  return state.record;
}
export function getInspectionEvents(inspectionId: string, ownerId: string): InspectionEvent[] {
  const state = inspections.get(inspectionId);
  if (!state) throw new InspectionError("INSPECTION_NOT_FOUND", "no inspection with that id");
  if (state.record.ownerId !== ownerId) throw new InspectionError("INSPECTION_NOT_OWNED", "this inspection belongs to a different session");
  return state.events;
}
export function listInspections(ownerId: string): InspectionRecord[] {
  return [...inspections.values()].filter((s) => s.record.ownerId === ownerId).map((s) => s.record).reverse();
}
export function listInspectionsForJob(jobId: string, ownerId: string): InspectionRecord[] {
  return [...inspections.values()].filter((s) => s.record.ownerId === ownerId && s.record.jobId === jobId).map((s) => s.record).reverse();
}
export function cancelInspection(inspectionId: string, ownerId: string): InspectionRecord {
  const state = inspections.get(inspectionId);
  if (!state) throw new InspectionError("INSPECTION_NOT_FOUND", "no inspection with that id");
  if (state.record.ownerId !== ownerId) throw new InspectionError("INSPECTION_NOT_OWNED", "this inspection belongs to a different session");
  if (state.record.status !== "QUEUED" && state.record.status !== "RUNNING") return state.record;
  if (state.record.executionId) {
    // Real cancel path — reuses executionRuntime.ts's cancelRun(); the
    // subscribed listener in runTypeDiagnostic() finalizes the inspection
    // once the real process actually exits, never force-finalized here.
    try {
      cancelRun(state.record.executionId, ownerId);
    } catch { /* real run may already be gone/terminal */ }
    return state.record;
  }
  // In-process (non-command) inspections complete synchronously and are
  // never observed QUEUED/RUNNING by the time a cancel could reach them.
  return state.record;
}

// ---- Real fresh source-hash comparison for staleness detection ----
export async function isFindingStale(record: InspectionRecord): Promise<boolean> {
  if (record.targetType !== "file" || !record.sourceHash) return false;
  try {
    const { buf } = await resolveTargetFile(record.targetPath);
    return sha256Hex(buf) !== record.sourceHash;
  } catch {
    return true; // file no longer resolves the same way — treat as stale, never guessed fresh
  }
}

// ---- Test-only introspection ----
export function __debugInspectionCount(): number {
  return inspections.size;
}

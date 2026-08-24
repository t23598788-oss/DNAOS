import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  KeychainAuditEvent,
  KeychainCommandRunner,
  KeychainFailureCode,
  KeychainReference,
  KeychainResolution,
} from "./types";

const SECURITY = "/usr/bin/security";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const SAFE_PART = /^[^\u0000\r\n]{1,512}$/;

/**
 * 2026-08-24 (Owner, "Single Process Creation Gate — Consolidation"):
 * this used to call `execFile("/usr/bin/security", ...)` directly — any
 * caller with a reference to this module could invoke arbitrary Keychain
 * operations. It now routes through
 * `execution/run/contract.ts#requestProcessExecution` (the Process
 * Gate), which resolves `keychain.find-generic-password`/
 * `keychain.add-generic-password` against `execution/run/process-registry.ts`'s
 * real `allowed_callers` list — a technical check, never a comment — and
 * executes via `control/agent-host/`'s real sandbox-exec (reused). The
 * resolved SECRET VALUE stays in-process memory only: this file never
 * logs it, and the Process Gate's own audit trail records only a
 * null `stdout_reference`, never the raw stdout content.
 */
const nativeCommandRunner: KeychainCommandRunner = async (executable, args, options) => {
  if (executable !== SECURITY) return { stdout: "", stderr: `EXECUTABLE_NOT_REGISTERED: only ${SECURITY} is ever requested by this provider`, exitCode: 1 };
  const executableId = args[0] === "add-generic-password" ? "keychain.add-generic-password" : "keychain.find-generic-password";
  const { requestProcessExecution } = await import("../../execution/run/contract");
  const result = await requestProcessExecution({
    request_id: `pg-req-${randomUUID()}`,
    parent_work_order_id: null,
    requester_identity: "credentials/macos-keychain/provider.ts",
    executable_id: executableId,
    argv: [...args],
    cwd: "/tmp/dna-os-process-gate",
    timeout_ms: options.timeout,
  });
  if (result.status !== "EXECUTED") return { stdout: "", stderr: `${result.status}: ${result.reason ?? "denied by Process Gate"}`, exitCode: 1 };
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exit_code ?? 1 };
};

function safeReference(reference: KeychainReference): boolean {
  return SAFE_PART.test(reference.service) && SAFE_PART.test(reference.account);
}

function failure(reference: KeychainReference, code: KeychainFailureCode, reason: string): KeychainResolution {
  return { ok: false, code, reason, credential_source: `keychain:${reference.service}/${reference.account}` };
}

function classifyFailure(result: { exitCode: number; stderr: string; signal?: string }): "PERMISSION_DENIED" | "NOT_FOUND" | "FAILED" {
  const text = result.stderr.toLowerCase();
  if (/denied|authorization|user interaction|(-25293)|(-128)/.test(text)) return "PERMISSION_DENIED";
  if (/could not be found|item not found|(-25300)/.test(text)) return "NOT_FOUND";
  return "FAILED";
}

export interface MacOsKeychainProviderOptions {
  commandRunner?: KeychainCommandRunner;
  auditPath?: string;
  platform?: string;
  defaultTimeoutMs?: number;
}

/**
 * Real macOS Keychain lookup. The command is fixed and allowlisted. In
 * particular, it never uses `security add-trusted-cert`, `set-key-partition-
 * list`, `-A`, AppleScript, Accessibility, or any UI automation.
 */
export class MacOsKeychainProvider {
  private readonly run: KeychainCommandRunner;
  private readonly auditPath: string;
  private readonly platform: string;
  private readonly defaultTimeoutMs: number;
  private readonly completedKeys = new Set<string>();

  constructor(options: MacOsKeychainProviderOptions = {}) {
    this.run = options.commandRunner ?? nativeCommandRunner;
    this.auditPath = resolve(options.auditPath ?? "audit/credential-audit/keychain-audit.jsonl");
    this.platform = options.platform ?? process.platform;
    this.defaultTimeoutMs = Math.min(Math.max(options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
  }

  async resolve(reference: KeychainReference, options: { timeoutMs?: number; signal?: AbortSignal; idempotencyKey?: string } = {}): Promise<KeychainResolution> {
    const source = `keychain:${reference.service}/${reference.account}`;
    if (!safeReference(reference)) return failure(reference, "INVALID_REFERENCE", "Keychain service/account contains an invalid or oversized value");
    if (options.idempotencyKey && this.completedKeys.has(options.idempotencyKey)) return failure(reference, "DUPLICATE_WORK_ORDER", "duplicate credential work order suppressed");
    // Claim the key before any OS call. This suppresses concurrent retries and
    // also makes a terminal BLOCKED/FAILED result idempotent without caching a
    // secret in memory or on disk.
    if (options.idempotencyKey) this.completedKeys.add(options.idempotencyKey);
    if (this.platform !== "darwin") return failure(reference, "NOT_MACOS", `macOS Keychain provider unavailable on ${this.platform}`);
    if (options.signal?.aborted) return failure(reference, "CANCELLED", "credential work order was cancelled before the OS call");

    const timeout = Math.min(Math.max(options.timeoutMs ?? this.defaultTimeoutMs, 1_000), MAX_TIMEOUT_MS);
    const result = await this.run(SECURITY, ["find-generic-password", "-s", reference.service, "-a", reference.account, "-w"], { timeout, signal: options.signal });
    let outcome: KeychainResolution;
    if (result.signal === "SIGTERM" || result.signal === "SIGKILL") outcome = failure(reference, "TIMEOUT", "Keychain lookup exceeded its bounded timeout");
    else if (options.signal?.aborted) outcome = failure(reference, "CANCELLED", "credential work order was cancelled");
    else if (result.exitCode !== 0) {
      const code = classifyFailure(result);
      outcome = failure(reference, code, code === "PERMISSION_DENIED" ? "macOS denied Keychain access; complete the native prompt or grant access manually" : code === "NOT_FOUND" ? "Keychain item was not found" : "macOS Keychain lookup failed");
    } else if (!result.stdout.trim()) outcome = failure(reference, "FAILED", "macOS returned an empty Keychain value");
    else outcome = { ok: true, secret: result.stdout.trim(), credential_source: source, kind: reference.kind };

    this.audit(reference, outcome.ok ? "RESOLVED" : outcome.code);
    return outcome;
  }

  private audit(reference: KeychainReference, outcome: KeychainAuditEvent["outcome"]): void {
    const event: KeychainAuditEvent = { recorded_at: new Date().toISOString(), operation: "resolve", service: reference.service, account: reference.account, kind: reference.kind, outcome, prompt: "OS_NATIVE_ONLY" };
    try {
      mkdirSync(dirname(this.auditPath), { recursive: true });
      appendFileSync(this.auditPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      // Audit failure never changes the already-determined credential result.
    }
  }
}

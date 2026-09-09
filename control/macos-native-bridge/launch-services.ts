/**
 * Launch Services via /usr/bin/open (execFile, shell:false). Not /bin/sh.
 */

import { execFile as execFileCb } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { getRegisteredApplication, getRegisteredLocalResource, resolveLogicalPath } from "../local-resource-access/contract";
import { isDarwin, openMode } from "./host-runtime";

const execFile = promisify(execFileCb);
const OPEN_BIN = "/usr/bin/open";
const TEXT_EDIT_BUNDLE = "com.apple.TextEdit";

export interface NativeInvocation {
  readonly argv0: string;
  readonly argv: readonly string[];
  readonly shell: false;
  readonly executed: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exit_code: number | null;
}

async function launchServices(argv: readonly string[]): Promise<NativeInvocation> {
  if (!isDarwin() || !existsSync(OPEN_BIN)) {
    return { argv0: OPEN_BIN, argv, shell: false, executed: false, stdout: "", stderr: "LAUNCH_SERVICES_UNAVAILABLE", exit_code: null };
  }
  if (openMode() !== "execute") {
    return { argv0: OPEN_BIN, argv, shell: false, executed: false, stdout: "RECORD_ONLY", stderr: "", exit_code: 0 };
  }
  try {
    const ran = await execFile(OPEN_BIN, [...argv], { timeout: 8_000 });
    return { argv0: OPEN_BIN, argv, shell: false, executed: true, stdout: ran.stdout, stderr: ran.stderr, exit_code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return { argv0: OPEN_BIN, argv, shell: false, executed: false, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? error), exit_code: typeof err.code === "number" ? err.code : 1 };
  }
}

export async function observeRegisteredApplicationProcess(): Promise<{ seen: boolean; process: string | null }> {
  try {
    const ran = await execFile("/bin/ps", ["-axo", "comm="], { timeout: 5_000 });
    const seen = /TextEdit/.test(ran.stdout);
    return { seen, process: seen ? "TextEdit" : null };
  } catch {
    return { seen: false, process: null };
  }
}

export async function openRegisteredApplication(): Promise<NativeInvocation | { ok: false; reason_code: string }> {
  const app = getRegisteredApplication("app://macos/textedit");
  if (!app || app.availability !== "AVAILABLE") return { ok: false, reason_code: "APPLICATION_UNAVAILABLE" };
  if (app.bundle_id !== TEXT_EDIT_BUNDLE) return { ok: false, reason_code: "APPLICATION_NOT_REGISTERED" };
  return launchServices(["-g", "-b", TEXT_EDIT_BUNDLE]);
}

export async function openRegisteredDocument(resource_id: string, logical_path: string): Promise<NativeInvocation | { ok: false; reason_code: string }> {
  const resource = getRegisteredLocalResource(resource_id);
  if (!resource) return { ok: false, reason_code: "UNKNOWN_RESOURCE" };
  const resolved = resolveLogicalPath(resource, logical_path);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  return launchServices(["-g", "-b", TEXT_EDIT_BUNDLE, resolved.abs]);
}

export async function revealRegisteredResource(resource_id: string, logical_path: string): Promise<NativeInvocation | { ok: false; reason_code: string }> {
  const resource = getRegisteredLocalResource(resource_id);
  if (!resource) return { ok: false, reason_code: "UNKNOWN_RESOURCE" };
  const resolved = resolveLogicalPath(resource, logical_path);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  return launchServices(["-R", resolved.abs]);
}

export function getDefaultApplication(logical_path: string): { ok: true; declared_handler: string | null; user_ls_database: "NOT_AVAILABLE"; source: string } {
  const app = getRegisteredApplication("app://macos/textedit");
  const plist = app?.data_scope[0] ?? "";
  const text = plist && existsSync(plist) ? readFileSync(plist, "utf8") : "";
  const ext = logical_path.toLowerCase().split(".").pop() ?? "";
  const handlesTxt = text.includes("public.plain-text") || text.includes(`<string>${ext}</string>`) || ext === "txt" || ext === "rtf";
  return {
    ok: true,
    declared_handler: handlesTxt ? TEXT_EDIT_BUNDLE : null,
    user_ls_database: "NOT_AVAILABLE",
    source: "APPLICATION_RESOURCE_V1 Info.plist CFBundleDocumentTypes",
  };
}

export function getResourceDisplayMetadata(resource_id: string, logical_path: string): Record<string, unknown> {
  const resource = getRegisteredLocalResource(resource_id);
  if (!resource) return { ok: false, reason_code: "UNKNOWN_RESOURCE" };
  const resolved = resolveLogicalPath(resource, logical_path);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  const st = statSync(resolved.abs);
  return {
    ok: true,
    logical_path,
    kind: st.isDirectory() ? "FOLDER" : "FILE",
    bytes: st.size,
    modified_at: st.mtime.toISOString(),
    abs_omitted: true,
  };
}

export function nativeOpenUsesShell(): false {
  return false;
}

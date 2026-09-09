/**
 * หน้าที่: ช่องตั้งค่า credential ของเจ้าของบน Owner Settings — สองเส้นทางเท่านั้น
 * คือ "อ่านสถานะ" กับ "บันทึกค่าใหม่" (Owner, 2026-09-02).
 *
 * ไม่มีที่เก็บความลับใหม่ที่นี่ ไฟล์นี้เป็นเพียงสายไฟระหว่างหน้าจอกับของที่มีอยู่แล้ว:
 *
 *   Owner Settings UI
 *     -> control/owner-authentication  (ต้องมี session ที่ยัง ACTIVE จริง)
 *     -> credentials/macos-keychain#registerOwnerApiCredential
 *     -> execution/run process gate (keychain.add-generic-password)
 *     -> macOS Keychain                        <- ความลับอยู่ที่นี่ที่เดียว
 *     -> credentials/registry                  <- เก็บเฉพาะ "ตัวชี้" ไม่มีค่า
 *
 * ทำไมต้องมี allowlist ของ ref: ถ้าเปิดให้เขียน credential_ref อะไรก็ได้ นี่จะ
 * กลายเป็น "endpoint เขียนความลับทั่วไป" ซึ่งเป็นของที่ระบบนี้ตั้งใจไม่มี
 * จึงรับเฉพาะ ref ที่เจ้าของประกาศไว้ล่วงหน้า และ metadata ของแต่ละ ref
 * (provider/service/account) ถูกกำหนดที่นี่ ไม่ใช่ให้ผู้เรียกส่งมา — ผู้เรียกส่ง
 * มาได้อย่างเดียวคือค่าความลับ
 *
 * Input: HTTP method/path/body.
 * Output: `handleOwnerCredentialRoute` (คืน null เมื่อ path ไม่ใช่ของไฟล์นี้).
 * Dependency ที่อนุญาต: ../../control/owner-authentication/contract.ts,
 * ../../credentials/macos-keychain/index.ts,
 * ../../credentials/registry/api-credential-registry.ts.
 * สิ่งที่ห้ามแตะ: ห้ามคืนค่าความลับกลับออกไปไม่ว่ากรณีใด, ห้าม log/persist
 * ค่าความลับที่นี่, ห้ามข้ามการตรวจ owner session, ห้ามรับ credential_ref
 * นอกรายการข้างล่าง.
 */

import { validateOwnerSession } from "../../control/owner-authentication/contract";
import { registerOwnerApiCredential } from "../../credentials/macos-keychain/index";
import { findApiCredential } from "../../credentials/registry/api-credential-registry";

export interface OwnerCredentialReply {
  status: number;
  body: Record<string, unknown>;
}

/**
 * credential ที่เจ้าของตั้งค่าได้จากหน้าจอ — ประกาศไว้ตายตัว
 *
 * `service`/`keychainAccount` คือที่อยู่จริงใน Keychain ส่วน `credential_ref`
 * คือชื่อที่ระบบอื่นใช้อ้างถึงมัน ทั้งคู่ถูกกำหนดที่นี่ ผู้เรียกเปลี่ยนไม่ได้
 */
const OWNER_SETTABLE = {
  "credential://anthropic/owner/agent-runtime": {
    provider: "anthropic",
    account: "owner",
    scope: ["AGENT_RUNTIME_MODEL_ACCESS"] as readonly string[],
    service: "dna-os-anthropic",
    keychainAccount: "owner-agent-runtime",
    label: "Anthropic API Key — โหมดสำรอง (ไม่ใช่เส้นทางหลัก)",
    /**
     * OPTIONAL_PROVIDER_API_MODE (Owner, IMPLEMENT_LOCAL_CLAUDE_CODE_TRUSTED_
     * EXECUTION_BOUNDARY ข้อ 9)
     *
     * เส้นทางหลักของ coding agent คือ `control/claude-execution-boundary/`
     * ซึ่งใช้ Claude Code ที่ล็อกอินอยู่บนเครื่องนี้แล้ว ไม่มีค่าใช้จ่าย API
     * ค่าที่ตั้งตรงนี้จะ "ไม่ถูกเลือกอัตโนมัติ" ตราบใดที่โหมดเครื่องยังใช้ได้ —
     * และเมื่อโหมดเครื่องใช้ไม่ได้ ระบบรายงาน AUTH_UNAVAILABLE แล้วหยุด
     * ไม่สลับมาโหมดนี้เอง เพราะการสลับมีผลต่อค่าใช้จ่ายของเจ้าของ
     */
    mode: "OPTIONAL_PROVIDER_API_MODE",
    canonical_mode: "LOCAL_MACHINE_AUTH via control/claude-execution-boundary/",
    auto_selected: false,
  },
  /** DNA OS Google Workspace OAuth client secret — Owner biometric admission only. */
  "credential://google/workspace/oauth-client/client-secret": {
    provider: "google_workspace_oauth_client",
    account: "oauth-client",
    scope: ["OAUTH_CLIENT_SECRET"] as readonly string[],
    service: "dna-os-google-workspace-oauth-client",
    keychainAccount: "client-secret",
    label: "Google Workspace OAuth client secret (DNA OS client — not Deadboard GMAIL_CLIENT_*)",
    mode: "OWNER_ADMISSION_REQUIRED",
    canonical_mode: "POST /computer-use/owner/verify → ACTIVE session → POST /owner/credential",
    auto_selected: false,
  },
} as const;

type SettableRef = keyof typeof OWNER_SETTABLE;

const isSettable = (ref: string): ref is SettableRef => Object.prototype.hasOwnProperty.call(OWNER_SETTABLE, ref);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * สถานะของหนึ่ง credential — ตอบได้แค่ "ตั้งค่าแล้วหรือยัง" กับที่อยู่ของหลักฐาน
 *
 * ค่าที่คืนมาจากทะเบียน ซึ่งตามการออกแบบของมันเองไม่เคยถือความลับอยู่แล้ว
 * (credentials/registry เก็บ credential_ref/provider/account/scope/status/
 * resolver_service/resolver_account) จึงไม่มีอะไรให้กรองออกที่นี่
 */
function statusOf(ref: SettableRef): Record<string, unknown> {
  const meta = OWNER_SETTABLE[ref];
  const entry = findApiCredential(ref);
  return {
    credential_ref: ref,
    label: meta.label,
    provider: meta.provider,
    account: meta.account,
    scope: meta.scope,
    state: entry ? "CONFIGURED" : "NOT_CONFIGURED",
    mode: meta.mode,
    canonical_mode: meta.canonical_mode,
    auto_selected: meta.auto_selected,
    registry_status: entry?.status ?? null,
    updated_at: entry?.updated_at ?? null,
    created_at: entry?.created_at ?? null,
    // ที่อยู่ของความลับ ไม่ใช่ความลับ — บอกได้ว่าไปหาที่ไหน แต่อ่านค่าไม่ได้
    stored_in: entry ? `${entry.resolver_kind}:${entry.resolver_service}/${entry.resolver_account}` : `macos_keychain:${meta.service}/${meta.keychainAccount}`,
  };
}

export async function handleOwnerCredentialRoute(
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
): Promise<OwnerCredentialReply | null> {
  if (method === "GET" && path === "/owner/credentials") {
    return { status: 200, body: { credentials: (Object.keys(OWNER_SETTABLE) as SettableRef[]).map(statusOf) } };
  }

  if (method === "GET" && path === "/owner/credential/status") {
    const ref = str(query.get("credential_ref"));
    if (!isSettable(ref)) return { status: 400, body: { error: "UNKNOWN_CREDENTIAL_REF", credential_ref: ref } };
    return { status: 200, body: statusOf(ref) };
  }

  if (method === "POST" && path === "/owner/credential") {
    const b = (body ?? {}) as Record<string, unknown>;
    const ref = str(b.credential_ref);
    if (!isSettable(ref)) return { status: 400, body: { error: "UNKNOWN_CREDENTIAL_REF", credential_ref: ref } };

    // ประตูสิทธิ์: ต้องเป็นเจ้าของที่มี session จริงและยังไม่หมดอายุ
    // ใช้ตัวตรวจเดียวกับที่ computer-use ใช้อยู่ ไม่ได้เขียนกฎใหม่
    const sessionId = str(b.owner_session_id);
    if (!sessionId) return { status: 401, body: { error: "OWNER_SESSION_REQUIRED" } };
    const session = validateOwnerSession(sessionId);
    if (!session.ok) {
      return { status: 403, body: { error: session.reason_code, detail: "detail" in session ? String(session.detail ?? "") : "" } };
    }

    const secret = typeof b.secret === "string" ? b.secret : "";
    if (secret.trim() === "") return { status: 400, body: { error: "SECRET_REQUIRED" } };

    const meta = OWNER_SETTABLE[ref];
    try {
      const result = await registerOwnerApiCredential({
        requester_identity: "transport/owner-command-http/owner-credential-routes.ts",
        credential_ref: ref,
        provider: meta.provider,
        account: meta.account,
        scope: meta.scope,
        service: meta.service,
        keychainAccount: meta.keychainAccount,
        secret,
      });
      // คืนเฉพาะสถานะ ไม่มีทางที่ค่าจะย้อนกลับออกไปทางนี้
      return { status: 200, body: { saved: true, credential_ref: result.credential_ref, ...statusOf(ref) } };
    } catch (error) {
      // ข้อความ error ของชั้นล่างไม่เคยมีค่าความลับอยู่ในนั้น (ดู api-registration.ts)
      return { status: 500, body: { error: "CREDENTIAL_WRITE_FAILED", detail: error instanceof Error ? error.message : String(error) } };
    }
  }

  return null;
}

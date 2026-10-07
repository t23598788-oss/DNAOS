/**
 * หน้าที่: ตัวเรียกทรัพยากร MCP ระยะไกลของ DNA OS เอง — ค้นเครื่องมือจริง
 * เทียบกับทะเบียน แล้วเรียกเฉพาะที่ผ่านการตรวจสิทธิ์
 *
 * ลำดับเป็นข้อบังคับ (Owner, 2026-09-05 ข้อ 10): ตรวจ availability, credential
 * status, read/write class ให้ครบ *ก่อน* จะมีคำขอออกเน็ตแม้แต่ครั้งเดียว ทุก
 * ทางที่ปฏิเสธคืน network_request_made=false เพื่อให้พิสูจน์ได้ว่าไม่มีการยิงจริง
 *
 * ไม่รู้จักผู้ให้บริการใด: endpoint/transport มาจากแถวทรัพยากรในทะเบียน ส่วน
 * ความลับอยู่ที่ credentials/macos-keychain/ ที่นี่ถือได้แค่ credential_ref
 * (Owner: CLAUDE_CREDENTIAL_EXTRACTION = DENIED — ที่นี่ไม่มีทางอ่าน token ของ
 * Claude ได้เลย เพราะไม่เคยรับ token เข้ามาเป็นพารามิเตอร์)
 *
 * Input: RemoteMcpInvocation
 * Output: RemoteMcpExecution + แถวหลักฐานใน ./data/resource-executions.jsonl
 * Dependency ที่อนุญาต: ./types.ts, @modelcontextprotocol/sdk, ทะเบียน canonical,
 * credentials/registry/
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียน token/secret ลงหลักฐานหรือ log
 * - ห้ามเรียกเครื่องมือที่ tools/list ไม่ยืนยันว่ามีจริง
 * - ห้ามยิงเน็ตก่อนตรวจสิทธิ์ครบ
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { RemoteMcpExecution, RemoteMcpInvocation, RemoteMcpStatus } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
export const EXECUTION_FILE: string = join(HERE, "data", "resource-executions.jsonl");
const CANONICAL = join(process.cwd(), "software/registry-database/data/canonical");

/** แถวหลังชนะ — ทรัพยากรที่ถูกแทนแล้วต้องไม่ถูกเรียก */
function resourceRow(resourceId: string): { source_location?: string; status?: string } | null {
  let found: any = null;
  try {
    for (const line of readFileSync(join(CANONICAL, "resources.jsonl"), "utf-8").split("\n")) {
      if (line.trim() === "") continue;
      try { const r = JSON.parse(line); if (r.resource_id === resourceId) found = r; } catch { /* ข้ามแถวเสีย */ }
    }
  } catch { return null; }
  return found;
}

function finish(base: Omit<RemoteMcpExecution, "finished_at" | "duration_ms">, startedMs: number): RemoteMcpExecution {
  const finished_at = new Date().toISOString();
  const row: RemoteMcpExecution = { ...base, finished_at, duration_ms: Date.now() - startedMs };
  mkdirSync(dirname(EXECUTION_FILE), { recursive: true });
  appendFileSync(EXECUTION_FILE, `${JSON.stringify(row)}\n`, "utf-8");
  return row;
}

export async function invokeRemoteTool(input: RemoteMcpInvocation): Promise<RemoteMcpExecution> {
  const startedMs = Date.now();
  const started_at = new Date().toISOString();
  const id = `rex_${randomUUID()}`;
  const base = {
    resource_execution_id: id, command_id: input.command_id, work_id: input.work_id, task_id: input.task_id,
    resource_id: input.resource_id, capability_id: input.capability_id, credential_ref: input.credential_ref,
    tool_name: input.tool_name, endpoint: null as string | null, started_at,
    discovered_tools: [] as string[], structured_result: null as unknown,
    error_code: null as string | null, network_request_made: false, evidence_id: id,
  };
  const deny = (status: RemoteMcpStatus, code: string, reason: string) =>
    finish({ ...base, status, error_code: code, reason }, startedMs);

  // [1] ทรัพยากรต้องมีจริงและยังใช้ได้ — ตรวจก่อนแตะเน็ต
  const resource = resourceRow(input.resource_id);
  if (!resource) return deny("RESOURCE_UNAVAILABLE", "RESOURCE_NOT_IN_REGISTRY", "ทะเบียนไม่มีทรัพยากรนี้");
  if (String(resource.status) !== "REGISTERED") return deny("RESOURCE_UNAVAILABLE", "RESOURCE_NOT_REGISTERED", `สถานะทรัพยากรคือ ${resource.status}`);
  const endpoint = String(resource.source_location ?? "");
  if (!/^https?:\/\//.test(endpoint)) return deny("RESOURCE_UNAVAILABLE", "NO_REMOTE_ENDPOINT", `แถวทรัพยากรไม่ได้ชี้ปลายทางระยะไกล: "${endpoint}"`);

  // [2] นโยบายอ่าน/เขียน — งานอ่านอย่างเดียวต้องไม่มีทางเรียกเครื่องมือที่เขียนได้
  if (input.execution_policy.read_write_class === "EXTERNAL_WRITE" && !input.execution_policy.allow_external_write) {
    return deny("BLOCKED", "EXTERNAL_WRITE_NOT_AUTHORIZED", "งานนี้เป็นแบบอ่านอย่างเดียว การเขียนออกนอกระบบต้องได้รับอนุญาตแยก");
  }

  // [3] สิทธิ์ — ไม่มีใบ หรือใบไม่ ACTIVE = ไม่ยิงเน็ต
  if (input.credential_ref === null) {
    return deny("RESOURCE_UNAUTHORIZED", "NO_CREDENTIAL_REFERENCE", "DNA OS ยังไม่มีสิทธิ์ของตัวเองกับทรัพยากรนี้ — ต้องให้เจ้าของอนุญาตก่อน");
  }
  let credentialStatus: string | null = null;
  try {
    const { findApiCredential } = await import("../../credentials/registry/api-credential-registry");
    const entry: any = (findApiCredential as (r: string) => unknown)(input.credential_ref);
    credentialStatus = entry ? String(entry.status) : null;
  } catch { credentialStatus = null; }
  if (credentialStatus === null) return deny("RESOURCE_UNAUTHORIZED", "CREDENTIAL_REF_NOT_FOUND", "ทะเบียนสิทธิ์ไม่รู้จักตัวชี้นี้");
  if (credentialStatus !== "ACTIVE") return deny("RESOURCE_UNAUTHORIZED", `CREDENTIAL_${credentialStatus}`, `ใบอนุญาตอยู่ในสถานะ ${credentialStatus}`);

  // [4] ถึงตรงนี้เท่านั้นจึงมีคำขอออกเน็ต
  let client: any = null;
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    client = new Client({ name: "dna-os-remote-mcp-client", version: "1.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint));
    await client.connect(transport);

    // [5] ค้นเครื่องมือจริง แล้วเทียบกับสิ่งที่ทะเบียนอ้าง
    const listed: any = await client.listTools();
    const names: string[] = (listed?.tools ?? []).map((t: any) => String(t.name));
    if (!names.includes(input.tool_name)) {
      return finish({ ...base, endpoint, discovered_tools: names, network_request_made: true,
        status: "RESOURCE_CONTRACT_DRIFT", error_code: "TOOL_NOT_IN_REMOTE_SCHEMA",
        reason: `ทะเบียนอ้าง "${input.tool_name}" แต่ปลายทางประกาศ ${names.length} เครื่องมือและไม่มีตัวนี้ — ไม่เรียก` }, startedMs);
    }

    const result: any = await client.callTool({ name: input.tool_name, arguments: input.arguments });
    return finish({ ...base, endpoint, discovered_tools: names, network_request_made: true,
      status: "COMPLETED", structured_result: result?.structuredContent ?? result?.content ?? null,
      reason: `เรียก ${input.tool_name} ที่ ${endpoint} สำเร็จ` }, startedMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish({ ...base, endpoint, network_request_made: true, status: "FAILED",
      error_code: "REMOTE_CALL_FAILED", reason: message.slice(0, 200) }, startedMs);
  } finally {
    // RELEASE — ปิดการเชื่อมต่อทุกเส้นทาง ไม่ปล่อยค้าง
    try { await client?.close?.(); } catch { /* ปิดไม่ได้ก็ต้องไม่กลืนผล */ }
  }
}

/**
 * หน้าที่: พิสูจน์ว่าชั้น route เป็น generic จริง และปฏิเสธอย่างถูกต้องเมื่อไม่รู้
 * (Owner, 2026-09-02).
 *
 * ข้อที่สำคัญที่สุดคือ G1: ไฟล์ contract ต้องไม่มีชื่อ capability, provider หรือ
 * workflow ใดเลย ถ้าวันหนึ่งมีใครเติม "line" ลงไปเพื่อให้ LINE ทำงาน เทสต์นี้ต้องแดง
 * เพราะนั่นคือการเปลี่ยน router ให้กลายเป็น architecture ของ workflow เดียว
 *
 * Input: none — แถวสังเคราะห์ + ทะเบียนจริงแบบอ่านอย่างเดียว
 * Output: exit 0/1
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCapabilityRoute, type RouteStores } from "../contract";
import { resolveRouteFromDisk } from "../host-runtime";

let failures = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const at = () => new Date("2026-09-02T00:00:00.000Z");

const empty: RouteStores = { capabilities: [], resources: [], resourceCapabilities: [], runtimeTargets: [], connectionDeclarations: [] };
const withCap = (extra: Partial<RouteStores> = {}): RouteStores => ({
  ...empty,
  capabilities: [{ capability_id: "capability-aaa", canonical_name: "thing" }],
  resources: [{ resource_id: "resource-1", source_location: "some/where/" }],
  resourceCapabilities: [{ capability_id: "capability-aaa", resource_id: "resource-1" }],
  ...extra,
});

// ตรวจ "โค้ด" ไม่ใช่ "คำอธิบาย" — คอมเมนต์ที่พูดถึง Keychain คือการอธิบายว่า
// ทำไมถึงคืนแค่ตัวชี้ ซึ่งเป็นสิ่งที่ต้องการ ไม่ใช่การอ่านความลับ
const src = readFileSync(join(process.cwd(), "control/capability-route/contract.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
check("G1. the router names no capability, provider or workflow",
  !/\b(line|LINE|invoice|quotation|payment|document|railway|supabase|github|vercel|n8n)\b/.test(src),
  "naming a workflow here would make the router that workflow's architecture");
check("G2. the router cannot read a secret",
  !/keychain|process\.env|readFile|fetch\(/i.test(src),
  "credential_ref is a pointer; the value never passes through");

check("R1. unknown identity is refused, not guessed",
  resolveCapabilityRoute("nope", empty, at).outcome === "NO_CANONICAL_IDENTITY");
check("R2. identity without a declared address is NO_RUNTIME_BINDING",
  resolveCapabilityRoute("thing", withCap(), at).outcome === "NO_RUNTIME_BINDING",
  "being in the registry is not the same as being reachable");
check("R3. a local runtime target resolves to a callable address", (() => {
  const r = resolveCapabilityRoute("thing", withCap({
    runtimeTargets: [{ capability_id: "capability-aaa", network: { host: "127.0.0.1", port: 9999 }, health: { path: "/h" }, authority: "OBSERVE_ONLY", evidence_refs: ["e"] }],
  }), at);
  return r.outcome === "ROUTE_RESOLVED" && r.route?.address === "http://127.0.0.1:9999"
    && r.route?.runtime_kind === "LOCAL_SERVICE" && r.route?.health_path === "/h";
})());
check("R4. an outbound declaration resolves, carrying only a credential POINTER", (() => {
  const r = resolveCapabilityRoute("thing", withCap({
    connectionDeclarations: [{ executor_capability_id: "capability-aaa", endpoint: "https://x.example/api", protocol: "HTTPS", credential_ref: { ref: "credential://x/y" }, target_resolution: "RESOLVED" }],
  }), at);
  return r.outcome === "ROUTE_RESOLVED" && r.route?.runtime_kind === "OUTBOUND_CONNECTION"
    && r.route?.credential_ref === "credential://x/y";
})());
check("R5. two declared addresses is ambiguity, and ambiguity is refused",
  resolveCapabilityRoute("thing", withCap({
    runtimeTargets: [{ capability_id: "capability-aaa", network: { host: "127.0.0.1", port: 1 } }],
    connectionDeclarations: [{ executor_capability_id: "capability-aaa", endpoint: "https://x" }],
  }), at).outcome === "RUNTIME_BINDING_AMBIGUOUS",
  "choosing one would let the router invent which system the Owner is talking to");
check("R6. a target declared without host/port is incomplete, not callable",
  resolveCapabilityRoute("thing", withCap({ runtimeTargets: [{ capability_id: "capability-aaa", network: {} }] }), at).outcome === "NO_RUNTIME_BINDING");
check("R7. every resolution carries provenance", (() => {
  const r = resolveCapabilityRoute("thing", withCap({ runtimeTargets: [{ capability_id: "capability-aaa", network: { host: "h", port: 2 } }] }), at);
  return (r.route?.resolved_from.length ?? 0) >= 2;
})());

const live = resolveRouteFromDisk("control-workspace");
check("L1. the real Owner Application resolves from the real registry",
  live.outcome === "ROUTE_RESOLVED" && live.route?.address === "http://127.0.0.1:5181",
  live.outcome === "ROUTE_RESOLVED" ? `${live.route?.address} ${live.route?.runtime_kind}` : (live.reason ?? ""));
const other = resolveRouteFromDisk("os-ui");
check("L2. a registered capability with no declared runtime says so precisely",
  other.outcome === "NO_RUNTIME_BINDING",
  `${other.outcome}${other.reason ? `: ${other.reason.slice(0, 80)}` : ""}`);

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

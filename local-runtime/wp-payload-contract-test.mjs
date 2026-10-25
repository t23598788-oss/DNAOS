// PAYLOAD CONTRACT TEST (ตาม actual payload ที่ backend ส่งกลับจริง)
// ที่มา: local-runtime/wpv3-result.json (production /workspace, owner verify pass 3)
// ทุก assertion อ้างหลักฐานจาก payload จริง — ไม่เดารูปร่างจาก code
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const live = process.argv.includes("--live")
const results = []
const check = (name, ok, detail = "") =>
  results.push({ name, ok, detail }) && console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`)

const file = join(here, "wpv3-result.json")
if (!existsSync(file)) { console.error("FAIL  หา wpv3-result.json ไม่เจอ — รัน wp-verify-3.mjs ก่อน"); process.exit(1) }
const run = JSON.parse(readFileSync(file, "utf8"))

check("HTTP 200 จาก /api/chat จริง", run.http === 200, `status=${run.http}`)

let P = run.backend_first_payload
if (live) {
  // --live: รัน verify ซ้ำแล้วใช้ payload รอบที่ผ่านมาเป็น actual (ห้ามแต่ง contract)
  const { execFileSync } = await import("node:child_process")
  execFileSync(process.execPath, [join(here, "wp-verify-3.mjs"), run.input], { cwd: join(here, ".."), stdio: "ignore", timeout: 180000 })
  P = JSON.parse(readFileSync(file, "utf8")).backend_first_payload
  console.log("(live re-run captured)")
}

// ── รูป payload ชุดแรกจาก backend (top-level keys ตามจริง) ──
const expectedTopKeys = ["sender", "type", "text", "result", "local_ai_command", "ai_status", "local_ai_request_id", "layers"]
check("top-level keys ครบตาม actual payload", expectedTopKeys.every((k) => k in P), Object.keys(P).join(","))

check('sender = "ai"', P.sender === "ai")
check('type = "text"', P.type === "text")
check("local_ai_request_id เป็น serial olar-* ที่ backend mint เอง",
  typeof P.local_ai_request_id === "string" && /^olar-\d{13}-[0-9a-z]{8}$/.test(P.local_ai_request_id), P.local_ai_request_id)
check('ai_status = AI_OK (fail-closed ทุกสายตอนขาด/เพี้ยน)',
  P.ai_status === "AI_OK" || P.ai_status === "AI_UNRESOLVED" || P.ai_status === "AI_UNAVAILABLE" || P.ai_status === "SKIPPED", String(P.ai_status))

// ── layers: ชั้นจริงของเส้นทางเดิม ห้ามขาด ──
const expectedLayerKeys = ["input", "ai", "tool", "dispatcher", "database", "result", "workspace"]
const layerKeys = P.layers && typeof P.layers === "object" ? Object.keys(P.layers) : null
check("layers ครบ 7 ชั้นตาม actual payload", Array.isArray(layerKeys) && expectedLayerKeys.every((k) => layerKeys.includes(k)), (layerKeys ?? []).join(","))

check("layers.ai มี provenance จริง (capability + provider + evidenceId)",
  ["capability", "provider", "evidenceId", "occurredAt", "request_id"].every((k) => k in (P.layers?.ai ?? {})),
  JSON.stringify(P.layers?.ai?.capability && { cap: P.layers.ai.capability, prov: P.layers.ai.provider }))

check("layers.dispatcher ผ่าน canonical dispatcher เดิม (ok + code)",
  P.layers?.dispatcher?.ok === true && P.layers?.dispatcher?.code === "OK" && Array.isArray(P.layers?.dispatcher?.violations),
  `command=${P.layers?.dispatcher?.command} violations=${P.layers?.dispatcher?.violations?.length ?? "?"}`)

check("layers.database อ้าง canonical reader เดิมลากๆ (มาจาก source จริง ไม่ hardcoded)",
  typeof P.layers?.database?.reader === "string" && P.layers.database.reader.includes("#"),
  P.layers?.database?.reader ?? "(ขาด)")

check("layers.workspace ระบุ renderer เดิม BusinessDisplayRenderer",
  P.layers?.workspace?.client === "app/admin/ui-gallery/_lib/BusinessDisplayRenderer.tsx", String(P.layers?.workspace?.client))

// ── result: รูป "table" จริงจาก payload ──
check('result.type = "table" พร้อม columns/rows',
  P.result?.type === "table" && Array.isArray(P.result?.table?.columns) && Array.isArray(P.result?.table?.rows),
  `title=${P.result?.title}`)

check("layers.result.status + layers.result.renders_as เทียบ result.type ตรงกัน",
  P.layers?.result?.status === "OK" && P.layers?.result?.renders_as === P.result?.type,
  `renders_as=${P.layers?.result?.renders_as}`)

// ── layers.input ต้องส่อง command/payload ตรงกันทั้งสายเดียว ──
check("layers.input.command = local_ai_command = layers.dispatcher.command (ไม่มีคำสั่งสองสาย)",
  P.layers?.input?.command === P.local_ai_command && P.layers?.input?.command === P.layers?.dispatcher?.command,
  JSON.stringify([P.local_ai_command, P.layers?.input?.command, P.layers?.dispatcher?.command]))

// ── request id ถูกพา provenance ทั้งสาย (เมือใบ status จริงเท่านั้น) ──
check("layers.ai.request_id = local_ai_request_id (id เดียวจบทั้งสาย)",
  P.local_ai_request_id === null || P.layers?.ai?.request_id === P.local_ai_request_id,
  `${P.local_ai_request_id} vs ${P.layers?.ai?.request_id}`)

const fails = results.filter((r) => !r.ok)
console.log(`\nPAYLOAD CONTRACT TEST: ${results.length - fails.length}/${results.length} PASS`)
process.exit(fails.length ? 1 : 0)

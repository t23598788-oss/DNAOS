/**
 * FINANCIAL DOCUMENT & INTELLIGENCE RECOVERY — contract test (owner mission 2026-10-10)
 * ตรวจว่าทุกส่วนที่เพิ่ม/แก้ต่อเข้ากับ canonical path เดิมจริง: openai adapter,
 * LINE/command bridge gatewayContext, deterministic document Q&A, documents
 * list/detail/file API, /admin/documents page, single-copy file lookup
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), "utf-8")

let pass = 0
let fail = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    failures.push(`${name} ${detail}`)
    console.log(`  ✗ ${name} ${detail}`)
  }
}

console.log("── T1-T3 AI PROVIDER (openai adapter — แก้ ROOT CAUSE 'ไม่มี AI') ──")
{
  const registry = JSON.parse(read("registry/ai-adapter-registry.json"))
  const openai = registry.adapters.find((a: { id: string }) => a.id === "openai")
  check("T1 registry มี openai adapter", Boolean(openai))
  check("T1 openai enabled + priority", openai?.enabled === true && typeof openai?.priority === "number")
  check("T2 openai ประกาศ conversation.answer + intent.classify",
    openai?.capabilities?.includes("conversation.answer") && openai?.capabilities?.includes("intent.classify"))
  check("T2 config = OPENAI_API_KEY presence", openai?.configuration?.required_any_env?.includes("OPENAI_API_KEY"))
  const adapters = read("services/ai/adapters.ts")
  check("T3 adapters.ts implement openaiAdapter (fetch, no new dep)",
    adapters.includes("export const openaiAdapter") && adapters.includes("api.openai.com/v1/chat/completions"))
  check("T3 register ใน AI_ADAPTER_IMPLEMENTATIONS", /AI_ADAPTER_IMPLEMENTATIONS[\s\S]{0,200}openai: openaiAdapter/.test(adapters))
  const contract = read("services/ai/adapterContract.ts")
  check("T3 AiAdapterId union มี openai", contract.includes('"openai"'))
}

console.log("── T4-T6 LINE/COMMAND BRIDGE (gatewayContext fix — สาเหตุ 'ไม่มี AI session context') ──")
{
  const lineCmd = read("app/api/internal/line/command/route.ts")
  check("T4 line command route ส่ง gatewayContext", lineCmd.includes("ownerId: `line-owner:") && lineCmd.includes("sessionId: `line:"))
  const apiCmd = read("app/api/command/route.ts")
  check("T4 api/command route ส่ง gatewayContext", apiCmd.includes("ownerId: auth.id"))
  const pipeline = read("cognitive/pipeline.ts")
  check("T5 pipeline ใช้ answerDocumentQuestion", pipeline.includes('import { answerDocumentQuestion } from "@/engines/documents/qa"'))
  const hookIdx = pipeline.indexOf("const docAnswer = await answerDocumentQuestion")
  const aiIdx = pipeline.indexOf("const aiAction = await classifyIntentViaAi")
  check("T5 doc-QA hook ทำงานก่อน AI fallback", hookIdx > 0 && hookIdx < aiIdx)
  check("T6 answerWithAi แยกเหตุผล provider (ไม่ตอบเหมารวม 'ไม่มี AI')",
    pipeline.includes("NO_COMPATIBLE_ADAPTER") && pipeline.includes("AI Provider ยังไม่พร้อม"))
}

console.log("── T7-T12 DOCUMENT Q&A ENGINE (อ่านอย่างเดียว ไม่เขียน ไม่เดา) ──")
{
  const qa = read("engines/documents/qa.ts")
  check("T7 export answerDocumentQuestion", qa.includes("export async function answerDocumentQuestion"))
  check("T8 ไม่มีการเขียนใด ๆ (insert/update/delete/rpc)",
    !/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/.test(qa))
  check("T9 เปิดเอกสารด้วยเลขที่ (canonical เท่านั้น)",
    qa.includes('from("invoices")') && qa.includes('from("standalone_documents")'))
  check("T10 เปรียบเทียบใบแจ้งหนี้ 2 ใบ", qa.includes("เปรียบเทียบใบแจ้งหนี้"))
  check("T11 ค้นใบเสร็จตามวันที่ไทย (month map)", qa.includes("สิงหาคม") && qa.includes("THAI_MONTHS"))
  check("T12 สรุปเอกสารต่อบริษัท — ปฏิเสธเมื่อชื่อไม่ชัดเจน (ห้ามเดา)",
    qa.includes("rows.length === 1") && qa.includes("พบมากกว่า 1 รายหรือไม่พบ"))
}

console.log("── T13-T20 DOCUMENT MANAGEMENT API + PAGE ──")
{
  const list = read("app/api/admin/documents/_lib/listDocuments.ts")
  check("T13 list filters: ชื่อบริษัท/เลขเอกสาร", list.includes("companies.name.ilike"))
  check("T13 list filters: วันที่+ประเภท+สถานะ+จำนวนเงิน+เลขอ้างอิง",
    list.includes("dateFrom") && list.includes("document_type") && list.includes("status") && list.includes("minAmount") && list.includes("reference"))
  check("T14 artifact presence ทุกแถว (storage truth)", list.includes("document_artifacts") && list.includes("artifact:"))
  const detail = read("app/api/admin/documents/[id]/route.ts")
  check("T15 detail มี history (versions+artifacts+audit+delivery)",
    detail.includes("loadDocumentHistory") && detail.includes("document_versions") && detail.includes("audit_logs") && detail.includes("line_events"))
  const fileRoute = read("app/api/admin/documents/[id]/file/route.ts")
  check("T16 file route: kind pdf|png + source auto|original|preview + download",
    fileRoute.includes('"pdf" | "png"') && fileRoute.includes("download") && fileRoute.includes("x-document-file-origin"))
  check("T17 file route ไม่เขียน storage/DB (ไม่ storeDocumentArtifacts)",
    !fileRoute.includes("storeDocumentArtifacts") && !fileRoute.includes("persistGeneratedArtifact"))
  check("T18 file route ใช้ builder/renderer ตัวเดิม (createDocumentArtifacts)",
    fileRoute.includes("createDocumentArtifacts") && fileRoute.includes("buildDocDataFromRecord"))
  const helpers = read("app/api/admin/documents/[id]/recover-helpers.ts")
  check("T19 single-copy findStoredFiles (export จากที่เดียว)",
    helpers.includes("export async function findStoredFiles"))
  const recover = read("app/api/admin/documents/[id]/artifact-recover/route.ts")
  check("T19 artifact-recover ใช้ helper ตัวเดียวกัน (ไม่มี copy ซ้ำ)",
    recover.includes('from "../recover-helpers"') && !recover.includes("async function findExistingFiles"))
  const page = read("app/admin/documents/page.tsx")
  check("T20 /admin/documents page: ค้น+เปิด+ดาวน์โหลด+พิมพ์ (ไม่มีช่องถาม AI ซ้ำ — owner 2026-10-18)",
    page.includes("ค้นหาชื่อบริษัท") && page.includes("เปิด PDF") && page.includes("ดาวน์โหลด") && page.includes("พิมพ์")
    && !page.includes("พิมพ์คำถามเรื่องเอกสาร") && !page.includes("aiQuestion") && !page.includes("/api/chat") && !page.includes("aiBusy"))
  const linePage = read("app/admin/line-customers/page.tsx")
  const businessTools = read("public/material-workspace/business-tools.json")
  check("T20 ทางเข้าคลังเอกสารอยู่ที่ Sidebar หลัก (ONE NAVIGATION) — ไม่มี rail ซ้อนในหน้าแชท (owner 2026-10-18)",
    businessTools.includes('"route": "/admin/documents"')
    && linePage.includes("ONE NAVIGATION")
    && !linePage.includes("RAIL_ITEMS")
    && !linePage.includes("railItems="))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log("FAILED:", failures)
  process.exit(1)
}


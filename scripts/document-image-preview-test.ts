/**
 * DOCUMENT IMAGE & PREVIEW contract tests (owner mission 2026-10-10).
 *
 * ตรวจสัญญาของเส้น preview ที่ต่อเข้าระบบเดิม: ใช้ renderer เดิม · อ่านอย่าง
 * เดียว · ไม่ส่ง LINE · ไม่แก้สถานะการเงิน · ไม่สร้างเอกสาร · หน้าจอเดิม
 *
 * Run: npm run document-preview:test
 */
import { readFileSync, existsSync } from "node:fs"

let checks = 0
let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  checks++
  if (cond) console.log(`PASS  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ""}`)
  }
}
const read = (p: string): string => readFileSync(p, "utf8")

const ROUTE = "app/api/admin/line-customers/[lineUserId]/document-preview/route.ts"
const route = read(ROUTE)
const routeNoComments = route.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
const page = read("app/admin/line-customers/page.tsx")

// ── P1: existing renderer reuse (no new engine) ──────────────────────────────
check("P1a uses the existing engines/documents artifact renderer", route.includes('from "@/engines/documents/artifact"') && route.includes("createDocumentArtifacts("))
check("P1b uses the existing company settings + doc labels", route.includes('from "@/core/config/company-settings"') && route.includes("DOC_LABELS"))
check("P1c LINE presentation reuses the existing lineDocumentMessages builder", route.includes('from "@/gateway/document-artifact-storage"') && route.includes("lineDocumentMessages("))
check("P1d renderer itself untouched (exports the same entry)", read("engines/documents/artifact.ts").includes("export async function createDocumentArtifacts"))
// font bootstrap — production container has no fonts (real tofu incident 2026-10-10)
const artifact = read("engines/documents/artifact.ts")
check("P1e renderer installs the bundled Thai font before SVG render", artifact.includes("ensureThaiFontForSvg()") && existsSync("assets/fonts/NotoSansThai-Regular.ttf") && existsSync("assets/fonts/NotoSansThai-Bold.ttf"))

// ── P2: PREVIEW ONLY — no send path reachable ────────────────────────────────
check("P2a route never imports the send gateway (registry/communication)", !routeNoComments.includes("registry/communication") && !routeNoComments.includes("sendLineMessage"))
check("P2b route never calls sendInvoiceToLine / acknowledgePayment", !route.includes("sendInvoiceToLine") && !route.includes("acknowledgePayment"))
check("P2c response declares PREVIEW_ONLY + sent:false", route.includes('mode: "PREVIEW_ONLY"') && route.includes("sent: false"))
check("P2d line_presentation is a dry-run payload only (send_ready flag, no dispatch)", route.includes("send_ready") && !/send_ready[\s\S]{0,400}?await send/.test(routeNoComments))

// ── P3: read-only — no DB / storage mutation ─────────────────────────────────
check("P3a no insert into any table", !/\.from\([^)]+\)\s*\n?\s*\.insert\(/.test(routeNoComments) && !route.includes(".insert("))
check("P3b no update/delete", !route.includes(".update(") && !route.includes(".delete("))
check("P3c no storage upload (preview never writes artifacts)", !route.includes(".upload("))

// ── P4: money/identity integrity ─────────────────────────────────────────────
check("P4a totals come from the stored record (precomputedSummary verbatim)", route.includes("precomputedSummary") && route.includes("subtotal: doc.subtotal") && route.includes("total: doc.total"))
check("P4b no document number minting (uses stored docNumber)", route.includes("docNumber: doc.docNumber") && !/document_no:\s*`/.test(routeNoComments))
check("P4c recipient gate — doc must belong to the contact's company", route.includes("company_line_links") && route.includes("NOT_FOR_THIS_CONTACT"))
check("P4d missing original reported honestly as MISSING_SOURCE", route.includes("MISSING_SOURCE"))

// ── P5: preview contract (formats, auth, cache) ──────────────────────────────
check("P5a admin auth gate present", route.includes("requireAuth(ADMIN_TIER)"))
check("P5b formats json|png|pdf with download disposition", route.includes('["png", "pdf"].includes(format)') && route.includes('format === "json"') && route.includes("Content-Disposition"))
check("P5c private no-store caching (documents never public)", route.includes("private, no-store"))
check("P5d ORIGINAL vs PREVIEW are distinct sources", route.includes('source === "original"') && route.includes('"RENDERED_FROM_CANONICAL_RECORD"'))

// ── P6: admin screen wiring (same screen, no new chat screen) ────────────────
check("P6a page fetches document-preview json meta", page.includes("document-preview?table=") && page.includes('previewUrl("json"'))
check("P6b page renders the PNG preview image", page.includes('previewUrl("png", "preview")'))
check("P6c fullscreen toggle + Esc close exist", page.includes("setPreviewFull") && page.includes('e.key === "Escape"'))
check("P6d download + open-original actions exist", page.includes("ดาวน์โหลด PNG") && page.includes("เปิดไฟล์ต้นฉบับจริง"))
check("P6e conversation bubble links its document (extracted.document_id)", page.includes("m.extracted?.document_id") && page.includes("เปิดเอกสาร"))
check("P6f documents list has the preview button", page.includes("openPreview(d.table, d.id"))
check("P6g MISSING_SOURCE + PREVIEW ONLY shown honestly in UI", page.includes("MISSING_SOURCE") && page.includes("PREVIEW ONLY"))
check("P6h no new chat screen added (preview lives inside the existing page)", existsSync("app/admin/line-customers/page.tsx") && !existsSync("app/admin/document-preview"))

console.log(`\ndocument-image-preview: checks=${checks} passed=${checks - failures} failed=${failures}`)
process.exit(failures === 0 ? 0 : 1)

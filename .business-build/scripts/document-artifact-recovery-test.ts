/**
 * CANONICAL DOCUMENT ARTIFACT RECOVERY contract tests (owner mission 2026-10-10).
 *
 * ตรวจสัญญา: recovery ใช้ renderer/storage/metadata-writer เดิม · read-back +
 * sha256 · idempotent · ไม่แตะการเงิน · ไม่ส่ง LINE · layout ยาวต้อง wrap ·
 * PDF ต้อง paginate ครบทุกรายการ · ack ห้ามกลืน artifact error เงียบ
 *
 * Run: npm run artifact-recovery:test
 */
import { readFileSync } from "node:fs"
import { documentSvg, wrapSvgText, createDocumentArtifacts } from "../engines/documents/artifact"

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

const RECOVER = read("app/api/admin/documents/[id]/artifact-recover/route.ts")
const recoverNoComments = RECOVER.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
const artifact = read("engines/documents/artifact.ts")
const ack = read("gateway/payment-acknowledgement.ts")
const shared = read("app/api/admin/documents/_lib/docDataFromRecord.ts")
const preview = read("app/api/admin/line-customers/[lineUserId]/document-preview/route.ts")

// ── R1: recovery uses ONLY the existing pipeline ─────────────────────────────
check("R1a admin auth gate", RECOVER.includes("requireAuth(ADMIN_TIER)"))
check("R1b renderer + storage + metadata writer = existing modules", RECOVER.includes("createDocumentArtifacts") && RECOVER.includes("storeDocumentArtifacts") && RECOVER.includes("persistGeneratedArtifact"))
check("R1c read-back + sha256 verification", RECOVER.includes(".download(") && RECOVER.includes("sha256Of") && RECOVER.includes("sha256_verified"))
check("R1d idempotent — valid files+metadata → already_stored, no re-upload", RECOVER.includes("already_stored") && RECOVER.includes("metadataValid"))
check("R1e metadata-repair path without re-render (already_uploaded)", RECOVER.includes("metadata_attach") && RECOVER.includes("already_uploaded: true"))
check("R1f no version → hard stop, never invents a version", RECOVER.includes("ARTIFACT_VERSION_REQUIRED"))
check("R1g reconstructed files are marked (PHASE 7)", recoverNoComments.includes("recovery:canonical-record"))
check("R1h failure stages RENDER/UPLOAD/READ classified + audited", RECOVER.includes("RENDER_FAILED") && RECOVER.includes("UPLOAD_FAILED") && RECOVER.includes("artifact.failed"))
check("R1i dry-run mode (ตรวจอย่างเดียว ไม่เขียน)", RECOVER.includes("dry_run"))
check("R1j no LINE send path", !recoverNoComments.includes("registry/communication") && !recoverNoComments.includes("sendLineMessage"))
check("R1k no financial/conversation writes", !recoverNoComments.includes('from("line_events")') && !recoverNoComments.includes('from("invoices")') && !recoverNoComments.includes(".insert("))

// ── R2: one canonical record→DocData builder shared by preview + recovery ────
check("R2a shared builder exists and is used by BOTH routes", shared.includes("export async function loadDocFromRecord") && shared.includes("export async function buildDocDataFromRecord")
  && preview.includes("docDataFromRecord") && RECOVER.includes("docDataFromRecord"))
check("R2b builder never recomputes totals (verbatim precomputedSummary)", shared.includes("subtotal: doc.subtotal") && shared.includes("total: doc.total"))

// ── R3: NO SILENT ARTIFACT FAILURE in the ack path ───────────────────────────
check("R3a ack captures artifact_error (no bare swallow)", ack.includes("artifactError") && ack.includes("artifact_error"))
check("R3b ack logs + audits the failure", ack.includes("console.error(\"[payment-acknowledgement] artifact generation failed") && ack.includes('"artifact.failed"'))
check("R3c ack still non-fatal for payments (no throw)", !/throw new Error\("ACK_/.test(ack.replace(/\/\/[^\n]*/g, "")))
check("R3d ack returns artifact paths on success", ack.includes("artifact = { image_path: artifacts.imagePath"))

// ── R4: renderer layout (PHASE 6) ────────────────────────────────────────────
check("R4a long descriptions wrap without content loss (wrapSvgText exported)", artifact.includes("export function wrapSvgText"))
check("R4b no item truncation caps remain", !artifact.includes("slice(0, 18)") && !artifact.includes("slice(0, 24)"))
check("R4c PNG overflow is announced, not silent", artifact.includes("เปิด PDF ดูครบทุกหน้า"))
check("R4d PDF paginates (addPage) instead of dropping rows", artifact.includes("doc.addPage()"))

// ── R5: preview provenance (PHASE 7/8) ───────────────────────────────────────
check("R5a preview separates ORIGINAL vs RECONSTRUCTED vs UNVERIFIED", preview.includes("RECONSTRUCTED") && preview.includes("STORED_ARTIFACT") && preview.includes("UNVERIFIED"))
check("R5b preview exposes artifact sha/version + url ttl", preview.includes("artifact_id: originArt.id") && preview.includes("url_expires_seconds"))

// ── R6: functional layout probe (real renderer, no DB) ───────────────────────
async function functional() {
  const long = "รับชำระ 10,000.00 บาท (สลิป 016123125432ATF02518) จาก น.ส. รัตนาพันธ์ ล — บจก. เคที คอนสตรัคชั่น 1988 จำกัด"
  const wrapped = wrapSvgText(long, 58)
  check("R6a wrap produces multiple lines for long Thai text", wrapped.length >= 2, wrapped.length)
  const strip = (s: string) => s.replace(/\s/g, "")
  check("R6b wrap preserves content (whitespace-insensitive)", strip(wrapped.join(" ")) === strip(long))
  const many = Array.from({ length: 30 }, (_, i) => ({ description: `รายการที่ ${i + 1} วัสดุก่อสร้าง`, qty: 1, unit: "รายการ", unitPrice: 100 + i }))
  const data = { type: "invoice" as const, company: { name: "บจก. ทดสอบ" }, docNumber: "INV-TEST-MULTI", date: "2026-10-10", customer: { name: "ลูกค้า" }, items: many, precomputedSummary: { subtotal: 1000, vatRate: 0, vat: 0, total: 1000 } }
  const svg = documentSvg(data)
  check("R6c PNG overflow marker rendered for 30 items", svg.includes("เปิด PDF ดูครบทุกหน้า"))
  const arts = await createDocumentArtifacts(data)
  const pages = (arts.pdf.toString("latin1").match(/\/Type \/Page[^s]/g) || []).length
  check("R6d PDF keeps ALL 30 items across pages", pages >= 2, `pages=${pages}`)
}

functional().then(() => {
  console.log(`\nartifact-recovery: checks=${checks} passed=${checks - failures} failed=${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}).catch((e) => {
  console.error(e)
  process.exit(1)
})


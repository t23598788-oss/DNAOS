/**
 * Canonical document artifacts.
 *
 * A document is one business object. Channels receive artifacts generated
 * from the same DocData: a printable PDF and an image preview for LINE.
 * No channel-specific card/template is involved here.
 */
import path from "node:path"
import PDFDocument from "pdfkit"
import sharp from "sharp"
import { DOC_LABELS, type DocData, type DocItem } from "./engine"

export interface DocumentArtifacts {
  pdf: Buffer
  image: Buffer
  fileName: string
}

const PAGE_WIDTH = 794
const PAGE_HEIGHT = 1123
const MARGIN = 48

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function itemAmount(item: DocItem): number {
  return item.qty * item.unitPrice - (item.discount ?? 0)
}

// Font availability for SVG→PNG (repair 2026-10-10, found on production):
// Railway's Linux container ships NO fonts at all — librsvg/pango fell back to
// a tofu glyph for every character, so each production preview PNG was boxes
// (6-7KB instead of ~50KB). The PDF path was unaffected because PDFKit embeds
// the WOFF bytes. Fix: put the OFL-licensed Noto Sans Thai (bundled in
// assets/fonts) where fontconfig scans by default (~/.local/share/fonts) once
// per process, before the first render. macOS is unaffected (CoreText doesn't
// scan that dir and already renders Thai through system fonts); the SVG's
// font-family 'Noto Sans Thai' then matches exactly on Linux.
let thaiFontEnsured = false
function ensureThaiFontForSvg(): void {
  if (thaiFontEnsured) return
  thaiFontEnsured = true
  try {
    const fs = require("node:fs") as typeof import("node:fs")
    const sourceDir = path.join(process.cwd(), "assets/fonts")
    const targetDir = path.join(process.env.HOME || "/tmp", ".local", "share", "fonts")
    fs.mkdirSync(targetDir, { recursive: true })
    // Noto Sans Thai VARIABLE (OFL) — covers Thai + Latin + digits (the earlier
    // hinted per-script subset left every number as a tofu box on production).
    // Always overwrite: a previous deploy may have left the smaller subset in
    // place and the exists-check would have kept it forever.
    const name = "NotoSansThai-Regular.ttf"
    fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name))
  } catch {
    // ถ้าคัดลอกไม่ได้ ให้การ render แสดงผลด้วย fallback ที่มีอยู่ — ตรวจด้วยตา/เทสต์
  }
}


/**
 * Text wrapping สำหรับ PNG (owner mission 2026-10-10, ARTIFACT RECOVERY §6):
 * คำอธิบายยาวต้อง wrap โดยไม่เปลี่ยนเนื้อหาและไม่ทับคอลัมน์เงิน — ตัดที่
 * ขอบอักษรโดยพยายามแตกที่เว้นวรรคก่อน (ไทยไม่มี space จึง hard-cut ได้)
 */
export function wrapSvgText(text: string, maxChars: number): string[] {
  const out: string[] = []
  for (const paragraph of String(text).split(/\r?\n/)) {
    let line = ""
    for (const word of paragraph.split(" ")) {
      let w = word
      while (w.length > maxChars) {
        if (line) {
          out.push(line)
          line = ""
        }
        out.push(w.slice(0, maxChars))
        w = w.slice(maxChars)
      }
      const candidate = line ? `${line} ${w}` : w
      if (candidate.length > maxChars) {
        if (line) out.push(line)
        line = w
      } else {
        line = candidate
      }
    }
    out.push(line)
  }
  return out.length ? out : [""]
}

const SVG_DESC_MAX_CHARS = 58 // ≈ (794 - 96 - 210) / 8.2px ที่ 15px font — เว้นคอลัมน์เงิน 210px
const SVG_LINE_HEIGHT = 17

export function documentSvg(data: DocData): string {
  const label = DOC_LABELS[data.type] ?? DOC_LABELS.quotation
  const items = data.items.length > 0 ? data.items : [{ description: "ยอดเอกสาร", qty: 1, unit: "รายการ", unitPrice: data.precomputedSummary?.total ?? 0 }]
  const summary = data.precomputedSummary
  const subtotal = summary?.subtotal ?? items.reduce((total, item) => total + itemAmount(item), 0)
  const vat = summary?.vat ?? 0
  const total = summary?.total ?? subtotal + (data.shipping ?? 0) + (data.serviceFee ?? 0) - (data.discount ?? 0) + vat
  const itemStart = 330
  let cursor = itemStart
  const itemRows: string[] = []
  let renderedCount = 0
  for (const item of items) {
    const descLines = wrapSvgText(item.description, SVG_DESC_MAX_CHARS)
    const rowHeight = descLines.length * SVG_LINE_HEIGHT + 26
    if (cursor + rowHeight > PAGE_HEIGHT - 170) break // เว้นที่ให้ summary+footer ชัดเจน
    const y = cursor
    itemRows.push(`<line x1="${MARGIN}" y1="${y + rowHeight}" x2="${PAGE_WIDTH - MARGIN}" y2="${y + rowHeight}" stroke="#e5e7eb" />
      <text x="${MARGIN}" y="${y + 18}" class="item">${descLines.map((l, i) => `<tspan x="${MARGIN}" dy="${i === 0 ? 0 : SVG_LINE_HEIGHT}">${esc(l)}</tspan>`).join("")}</text>
      <text x="${PAGE_WIDTH - MARGIN}" y="${y + 18}" text-anchor="end" class="amount">${money(itemAmount(item))} บาท</text>
      <text x="${MARGIN}" y="${y + 18 + descLines.length * SVG_LINE_HEIGHT}" class="detail">${esc(`${item.qty} ${item.unit} × ${money(item.unitPrice)} บาท`)}</text>`)
    cursor += rowHeight
    renderedCount++
  }
  // PNG = หน้าแรกสำหรับดูแบบรูป — รายการที่เกินพื้นที่ต้องประกาศให้เห็น (ไม่หายเงียบ)
  const hiddenCount = items.length - renderedCount
  const overflowRow = hiddenCount > 0
    ? `<text x="${MARGIN}" y="${cursor + 18}" class="detail">… และอีก ${hiddenCount} รายการ — เปิด PDF ดูครบทุกหน้า</text>`
    : ""
  if (hiddenCount > 0) cursor += 30
  const summaryY = cursor + 34
  const company = data.company?.name ?? "DNA OS"
  const customer = data.customer?.name ?? ""

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">
    <style>
      text { font-family: 'Noto Sans Thai', sans-serif; fill: #1a1a1a; }
      .company { font-size: 24px; font-weight: 700; }
      .muted { font-size: 13px; fill: #666; }
      .title { font-size: 22px; font-weight: 700; }
      .label { font-size: 12px; fill: #888; }
      .item { font-size: 15px; font-weight: 600; }
      .detail { font-size: 12px; fill: #666; }
      .amount { font-size: 15px; font-weight: 600; }
      .total { font-size: 22px; font-weight: 700; }
    </style>
    <rect width="100%" height="100%" fill="white" />
    <line x1="${MARGIN}" y1="112" x2="${PAGE_WIDTH - MARGIN}" y2="112" stroke="#1a1a1a" stroke-width="2" />
    <text x="${MARGIN}" y="58" class="company">${esc(company)}</text>
    <text x="${MARGIN}" y="84" class="muted">${data.company?.taxId ? `เลขผู้เสียภาษี ${esc(data.company.taxId)}` : ""}</text>
    <text x="${PAGE_WIDTH - MARGIN}" y="58" text-anchor="end" class="title">${esc(label.th)}</text>
    <text x="${PAGE_WIDTH - MARGIN}" y="84" text-anchor="end" class="muted">${esc(label.en)} · ${esc(data.docNumber)}</text>
    <text x="${MARGIN}" y="158" class="label">ลูกค้า</text>
    <text x="${MARGIN}" y="184" class="item">${esc(customer)}</text>
    <text x="${PAGE_WIDTH - MARGIN}" y="158" text-anchor="end" class="label">วันที่</text>
    <text x="${PAGE_WIDTH - MARGIN}" y="184" text-anchor="end" class="muted">${esc(data.date)}</text>
    <line x1="${MARGIN}" y1="220" x2="${PAGE_WIDTH - MARGIN}" y2="220" stroke="#d1d5db" />
    <text x="${MARGIN}" y="270" class="label">รายการ</text>
    <text x="${PAGE_WIDTH - MARGIN}" y="270" text-anchor="end" class="label">จำนวนเงิน</text>
    ${itemRows.join("")}${overflowRow}
    <line x1="${PAGE_WIDTH - 310}" y1="${summaryY}" x2="${PAGE_WIDTH - MARGIN}" y2="${summaryY}" stroke="#1a1a1a" stroke-width="2" />
    <text x="${PAGE_WIDTH - 310}" y="${summaryY + 30}" class="muted">ยอดก่อนภาษี</text>
    <text x="${PAGE_WIDTH - MARGIN}" y="${summaryY + 30}" text-anchor="end" class="amount">${money(subtotal)} บาท</text>
    <text x="${PAGE_WIDTH - 310}" y="${summaryY + 58}" class="muted">ภาษีมูลค่าเพิ่ม</text>
    <text x="${PAGE_WIDTH - MARGIN}" y="${summaryY + 58}" text-anchor="end" class="amount">${money(vat)} บาท</text>
    <text x="${PAGE_WIDTH - 310}" y="${summaryY + 100}" class="total">ยอดสุทธิ</text>
    <text x="${PAGE_WIDTH - MARGIN}" y="${summaryY + 100}" text-anchor="end" class="total">${money(total)} บาท</text>
    ${data.notes ? `<text x="${MARGIN}" y="${PAGE_HEIGHT - 100}" class="muted">หมายเหตุ: ${esc(data.notes)}</text>` : ""}
    <text x="${PAGE_WIDTH / 2}" y="${PAGE_HEIGHT - 48}" text-anchor="middle" class="label">${esc(company)}</text>
  </svg>`
}

function createPdf(data: DocData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: data.docNumber ?? DOC_LABELS[data.type]?.th ?? "เอกสาร" } })
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => chunks.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)

    // PDFKit/fontkit handles the WOFF variant reliably in Node; the WOFF2
    // subset can fail during PDF finalization on some runtimes.
    // Font root resolution (repair 2026-10-10): turbopack-compiled server code
    // returns a VIRTUAL id from require.resolve (e.g. "[externals]/…" or
    // "[project]/…") that no fs.open() can open — found live while the admin
    // document-preview route first ran on dev. Same bytes, same fonts: fall
    // back to the real node_modules path (cwd), then fail loudly instead of
    // writing a tofu document.
    const fontCandidates = [
      (() => { try { return path.dirname(require.resolve("@fontsource/noto-sans-thai/package.json")) } catch { return "" } })(),
      path.join(process.cwd(), "node_modules/@fontsource/noto-sans-thai"),
      path.join(process.cwd(), "../node_modules/@fontsource/noto-sans-thai"),
    ].filter((p) => p && require("node:fs").existsSync(path.join(p, "files/noto-sans-thai-thai-400-normal.woff")))
    if (!fontCandidates.length) {
      throw new Error("FONT_NOT_FOUND: หาไฟล์ฟอนต์ @fontsource/noto-sans-thai ไม่เจอจาก path ทั้งหมด — หยุดก่อนสร้าง PDF ที่อาจเพี้ยน")
    }
    const fontRoot = fontCandidates[0]
    const font = path.join(fontRoot, "files/noto-sans-thai-thai-400-normal.woff")
    const boldFont = path.join(fontRoot, "files/noto-sans-thai-thai-700-normal.woff")
    doc.font(font)
    const label = DOC_LABELS[data.type] ?? DOC_LABELS.quotation
    const items = data.items.length > 0 ? data.items : [{ description: "ยอดเอกสาร", qty: 1, unit: "รายการ", unitPrice: data.precomputedSummary?.total ?? 0 }]
    const subtotal = data.precomputedSummary?.subtotal ?? items.reduce((total, item) => total + itemAmount(item), 0)
    const vat = data.precomputedSummary?.vat ?? 0
    const total = data.precomputedSummary?.total ?? subtotal + (data.shipping ?? 0) + (data.serviceFee ?? 0) - (data.discount ?? 0) + vat
    doc.font(boldFont).fontSize(18).text(data.company?.name ?? "DNA OS")
    doc.font(font).fontSize(9).fillColor("#666666").text(data.company?.taxId ? `เลขผู้เสียภาษี ${data.company.taxId}` : "")
    doc.moveDown(1.5).strokeColor("#1a1a1a").lineWidth(1.5).moveTo(MARGIN, doc.y).lineTo(546, doc.y).stroke()
    doc.moveDown(1).fillColor("#1a1a1a").font(boldFont).fontSize(16).text(label.th, { align: "right" })
    doc.font(font).fontSize(9).fillColor("#666666").text(`${label.en} · ${data.docNumber ?? ""}`, { align: "right" })
    doc.moveDown(1.5).fillColor("#888888").fontSize(9).text("ลูกค้า")
    doc.fillColor("#1a1a1a").font(boldFont).fontSize(11).text(data.customer?.name ?? "")
    doc.font(font).fontSize(9).fillColor("#666666").text(`${data.date ?? ""}${data.customer?.address ? ` · ${data.customer.address}` : ""}`)
    doc.moveDown(1.5).strokeColor("#d1d5db").lineWidth(0.7).moveTo(MARGIN, doc.y).lineTo(546, doc.y).stroke().moveDown(1)
    // ทุกจำนวนรายการ (owner mission §6): pdfkit เพิ่มหน้าใหม่เองเมื่อใกล้ขอบ
    // — ไม่มีการ slice/ตัดรายการทิ้ง และ desc ถูกจำกัดความกว้างไม่ให้ชน
    // คอลัมน์เงิน
    for (const item of items) {
      if (doc.y > 1123 - 130) doc.addPage()
      const yStart = doc.y
      doc.fillColor("#1a1a1a").font(boldFont).fontSize(10).text(item.description, MARGIN, yStart, { width: 340 })
      const afterDesc = doc.y
      doc.font(font).fontSize(9).text(`${item.qty} ${item.unit} × ${money(item.unitPrice)} บาท`, MARGIN, afterDesc, { width: 340 })
      const afterDetail = doc.y
      doc.font(boldFont).fontSize(10).text(`${money(itemAmount(item))} บาท`, MARGIN + 350, yStart, { width: 146, align: "right" })
      doc.y = Math.max(afterDetail, doc.y) + 4
      doc.strokeColor("#eeeeee").lineWidth(0.5).moveTo(MARGIN, doc.y).lineTo(546, doc.y).stroke().moveDown(0.5)
    }
    if (doc.y > 1123 - 210) doc.addPage()
    doc.moveDown(1).font(font).fontSize(10).fillColor("#666666").text(`ยอดก่อนภาษี  ${money(subtotal)} บาท`, { align: "right" })
    doc.text(`ภาษีมูลค่าเพิ่ม  ${money(vat)} บาท`, { align: "right" })
    doc.moveDown(0.4).font(boldFont).fontSize(15).fillColor("#1a1a1a").text(`ยอดสุทธิ  ${money(total)} บาท`, { align: "right" })
    if (data.notes) doc.moveDown(2).font(font).fontSize(9).fillColor("#666666").text(`หมายเหตุ: ${data.notes}`)
    doc.end()
  })
}

export async function createDocumentArtifacts(data: DocData): Promise<DocumentArtifacts> {
  ensureThaiFontForSvg()
  const svg = documentSvg(data)
  const [image, pdf] = await Promise.all([
    sharp(Buffer.from(svg)).png().toBuffer(),
    createPdf(data),
  ])
  const safeNumber = (data.docNumber ?? "document").replace(/[^a-zA-Z0-9_-]/g, "_")
  return { image, pdf, fileName: `${safeNumber}.pdf` }
}

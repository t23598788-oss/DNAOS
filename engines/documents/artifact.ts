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
    for (const name of ["NotoSansThai-Regular.ttf", "NotoSansThai-Bold.ttf"]) {
      const dest = path.join(targetDir, name)
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(sourceDir, name), dest)
    }
  } catch {
    // ถ้าคัดลอกไม่ได้ ให้การ render แสดงผลด้วย fallback ที่มีอยู่ — ตรวจด้วยตา/เทสต์
  }
}


function documentSvg(data: DocData): string {
  const label = DOC_LABELS[data.type] ?? DOC_LABELS.quotation
  const items = data.items.length > 0 ? data.items : [{ description: "ยอดเอกสาร", qty: 1, unit: "รายการ", unitPrice: data.precomputedSummary?.total ?? 0 }]
  const summary = data.precomputedSummary
  const subtotal = summary?.subtotal ?? items.reduce((total, item) => total + itemAmount(item), 0)
  const vat = summary?.vat ?? 0
  const total = summary?.total ?? subtotal + (data.shipping ?? 0) + (data.serviceFee ?? 0) - (data.discount ?? 0) + vat
  const rowHeight = 46
  const itemStart = 330
  const itemRows = items.slice(0, 18).map((item, index) => {
    const y = itemStart + index * rowHeight
    return `<line x1="${MARGIN}" y1="${y + rowHeight}" x2="${PAGE_WIDTH - MARGIN}" y2="${y + rowHeight}" stroke="#e5e7eb" />
      <text x="${MARGIN}" y="${y + 20}" class="item">${esc(item.description)}</text>
      <text x="${PAGE_WIDTH - MARGIN}" y="${y + 20}" text-anchor="end" class="amount">${money(itemAmount(item))} บาท</text>
      <text x="${MARGIN}" y="${y + 37}" class="detail">${esc(`${item.qty} ${item.unit} × ${money(item.unitPrice)} บาท`)}</text>`
  }).join("")
  const summaryY = itemStart + Math.max(items.length, 1) * rowHeight + 34
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
    ${itemRows}
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
    for (const item of items.slice(0, 24)) {
      doc.fillColor("#1a1a1a").font(boldFont).fontSize(10).text(item.description, { continued: true })
      doc.font(font).fontSize(9).text(`  ${item.qty} ${item.unit} × ${money(item.unitPrice)} บาท`, { continued: true })
      doc.text(`  ${money(itemAmount(item))} บาท`, { align: "right" })
      doc.moveDown(0.3).strokeColor("#eeeeee").lineWidth(0.5).moveTo(MARGIN, doc.y).lineTo(546, doc.y).stroke().moveDown(0.5)
    }
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

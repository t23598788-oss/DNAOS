/**
 * DNA OS Document Engine — STRICT RENDER MODE
 *
 * Template เดียว ข้อมูลชุดเดียว เปลี่ยนแค่ document_type
 * ทุกข้อความต้องมาจาก data parameter — ห้ามเดา ห้าม mock ห้าม placeholder
 * ถ้าไม่มีข้อมูล → ซ่อน section ทั้งก้อน
 *
 * COMPLIANCE POLICY v1.0 — LOCKED
 * ห้ามลายเซ็น / QR / PromptPay
 * Payment แสดงเฉพาะ paymentRequired=true
 */

import { sanitizeHtml } from "@/lib/middleware/sanitize";

export type DocType =
  | "quotation" | "boq" | "workorder" | "delivery" | "delivery_order"
  | "invoice" | "billing" | "receipt" | "purchase_order"
  | "debt_notice" | "management_fee" | "requisition"
  | "job_summary" | "monthly_summary";

export const DOC_LABELS: Record<DocType, { th: string; en: string; prefix: string }> = {
  quotation:       { th: "ใบเสนอราคา",      en: "QUOTATION",        prefix: "QUO" },
  boq:             { th: "ใบประมาณปริมาณงาน", en: "BILL OF QUANTITIES", prefix: "BOQ" },
  workorder:       { th: "ใบสั่งงาน",        en: "WORK ORDER",       prefix: "WO" },
  delivery:        { th: "ใบส่งของ",         en: "DELIVERY ORDER",   prefix: "DO" },
  delivery_order:  { th: "ใบส่งสินค้า",      en: "DELIVERY ORDER",   prefix: "DO" },
  invoice:         { th: "ใบแจ้งหนี้",       en: "INVOICE",          prefix: "INV" },
  billing:         { th: "ใบวางบิล",         en: "BILLING NOTE",     prefix: "BN" },
  receipt:         { th: "ใบรับเงิน",        en: "RECEIPT",          prefix: "REC" },
  purchase_order:  { th: "ใบสั่งซื้อ",       en: "PURCHASE ORDER",   prefix: "PO" },
  debt_notice:     { th: "ใบติดตามหนี้",     en: "DEBT NOTICE",      prefix: "DEM" },
  management_fee:  { th: "ใบค่าบริหาร",      en: "MANAGEMENT FEE",   prefix: "MGT" },
  requisition:     { th: "ใบเบิก",          en: "REQUISITION",      prefix: "REQ" },
  job_summary:     { th: "ใบสรุปงาน",       en: "JOB SUMMARY",      prefix: "JS" },
  monthly_summary: { th: "ใบสรุปรายเดือน",   en: "MONTHLY SUMMARY",  prefix: "MS" },
};

export interface DocItem {
  description: string;
  detail?: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount?: number;
}

export interface DocEvent {
  date: string;
  action: string;
}

export interface DocData {
  type: DocType;

  // Header — ต้องส่งมาจาก DB
  company?: { name?: string; taxId?: string };
  docNumber?: string;
  date?: string;
  status?: string;

  // Customer — แสดงเฉพาะที่ส่งมา
  customer?: { name?: string; taxId?: string; contact?: string; address?: string; phone?: string };

  // Project/Reference — แสดงเฉพาะที่ส่งมา
  project?: string;
  reference?: string;

  // Items — ต้องมีอย่างน้อย 1 รายการ
  items: DocItem[];

  // Summary
  shipping?: number;
  serviceFee?: number;
  discount?: number;
  vatRate?: number;
  paidAmount?: number;

  // Events — timeline ของเอกสาร
  events?: DocEvent[];

  // Payment — แสดงเฉพาะ paymentRequired=true
  paymentRequired?: boolean;
  payment?: { bank?: string; account?: string; accountName?: string; branch?: string; dueDate?: string };

  // Debt — แสดงเฉพาะที่ส่งมา
  debt?: { principal: number; fee: number; daysOverdue: number; interestRate: number; interestAccrued: number };

  notes?: string;
}

export interface DocResult {
  type: DocType;
  label: { th: string; en: string };
  docNumber: string;
  html: string;
  summary: { subtotal: number; shipping: number; serviceFee: number; discount: number; beforeVat: number; vat: number; total: number; paid: number; remaining: number };
}

export function generateDoc(data: DocData): DocResult {
  const label = DOC_LABELS[data.type];
  const docNumber = data.docNumber ?? "";
  const vatRate = data.vatRate ?? 0;

  const subtotal = data.items.reduce((s, i) => s + i.qty * i.unitPrice - (i.discount ?? 0), 0);
  const shipping = data.shipping ?? 0;
  const serviceFee = data.serviceFee ?? 0;
  const discount = data.discount ?? 0;
  const beforeVat = subtotal + shipping + serviceFee - discount;
  const vat = vatRate > 0 ? Math.round(beforeVat * vatRate * 100) / 100 : 0;
  const total = beforeVat + vat;
  const paid = data.paidAmount ?? 0;
  const remaining = total - paid;

  const f = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const show = (v: unknown) => v !== undefined && v !== null && v !== "";
  const esc = (v: string | undefined) => v ? sanitizeHtml(v) : "";
  const showPayment = data.paymentRequired === true && !!data.payment;
  const showDebt = !!data.debt;
  const showEvents = !!data.events?.length;
  const showCustomer = !!data.customer?.name;
  const showProject = show(data.project) || show(data.reference);

  const st = data.status ?? "";
  const stColor: Record<string, string> = { draft: "#94a3b8", issued: "#3b82f6", outstanding: "#f59e0b", overdue: "#ef4444", paid: "#22c55e" };

  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Sarabun,sans-serif;font-size:13px;color:#1a1a1a;background:#fff;width:800px;padding:24px 28px}
.hdr{display:flex;justify-content:space-between;border-bottom:3px solid #22c55e;padding-bottom:10px;margin-bottom:14px}
.hdr-l{font-size:10px;color:#555;line-height:1.5}
.hdr h1{font-size:20px;color:#22c55e;letter-spacing:2px}
.dtype{font-size:16px;font-weight:700;border:2px solid #22c55e;color:#22c55e;padding:3px 14px;display:inline-block}
.dtype-th{font-size:12px;font-weight:600;margin-top:2px}
.badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 10px;margin-top:4px;border-radius:4px;color:#fff;background:${stColor[st] ?? "#94a3b8"}}
.grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d1d5db;margin-bottom:12px}
.cell{padding:6px 8px;border:1px solid #d1d5db}
.lb{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.6px}
.vl{font-size:11px;font-weight:600;margin-top:1px}
.sub{font-size:9px;color:#666}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th{background:#22c55e;color:#fff;font-size:9px;font-weight:600;text-transform:uppercase;padding:6px 7px;text-align:left}
th.r,td.r{text-align:right}
th.c,td.c{text-align:center}
td{padding:6px 7px;border-bottom:1px solid #e5e7eb;font-size:11px}
tr:last-child td{border-bottom:2px solid #22c55e}
.iname{font-weight:600}.idesc{font-size:10px;color:#666;margin-top:1px}
.summ{display:flex;justify-content:flex-end;margin-bottom:12px}
.summ-r{width:220px}
.sr{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;border-bottom:1px solid #f3f4f6}
.sr.tot{border-top:2px solid #22c55e;border-bottom:2px solid #22c55e;font-size:14px;font-weight:700;padding:6px 0;margin-top:3px;color:#22c55e}
.events{margin-bottom:12px;border:1px solid #e5e7eb;border-radius:6px;padding:10px}
.events h3{font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.ev{display:flex;gap:12px;font-size:11px;padding:3px 0;border-bottom:1px solid #f3f4f6}
.ev:last-child{border:none}
.ev-date{color:#888;min-width:120px}
.ev-action{font-weight:500}
.debt{border:1.5px solid #ef4444;padding:8px 10px;margin-bottom:12px;background:#fef2f2;border-radius:6px}
.debt h3{font-size:12px;font-weight:700;color:#dc2626;margin-bottom:6px}
.debt .dr{display:flex;justify-content:space-between;padding:2px 0;font-size:11px}
.debt .dtot{font-weight:700;font-size:13px;border-top:1.5px solid #dc2626;padding-top:4px;margin-top:3px}
.pay{border:1px solid #d1d5db;padding:8px 10px;margin-bottom:12px;display:flex;justify-content:space-between;border-radius:6px}
.pay-l{font-size:10px;line-height:1.6}.pay-l .bk{font-weight:700;font-size:12px;color:#22c55e}
.ftr{text-align:center;font-size:9px;color:#aaa;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:6px}
</style></head><body>

<!-- HEADER -->
<div class="hdr">
<div class="hdr-l">${show(data.company?.name) ? `<h1>${esc(data.company!.name)}</h1>` : ""}${show(data.company?.taxId) ? `<p>เลขผู้เสียภาษี ${esc(data.company!.taxId)}</p>` : ""}</div>
<div style="text-align:right"><div class="dtype">${label.en}</div><div class="dtype-th">${label.th}</div>${show(docNumber) ? `<div style="font-size:11px;font-weight:600;margin-top:4px">${esc(docNumber)}</div>` : ""}${show(st) ? `<div class="badge">${esc(st.toUpperCase())}</div>` : ""}${show(data.date) ? `<div style="font-size:10px;color:#888;margin-top:2px">${esc(data.date)}</div>` : ""}</div>
</div>

${showCustomer || showProject ? `<!-- CUSTOMER + PROJECT -->
<div class="grid">
${showCustomer ? `<div class="cell"><div class="lb">ลูกค้า</div><div class="vl">${esc(data.customer!.name)}</div>${show(data.customer!.contact) ? `<div class="sub">${esc(data.customer!.contact)}</div>` : ""}${show(data.customer!.address) ? `<div class="sub">${esc(data.customer!.address)}</div>` : ""}${show(data.customer!.phone) ? `<div class="sub">${esc(data.customer!.phone)}</div>` : ""}</div>` : ""}
${show(data.customer?.taxId) ? `<div class="cell"><div class="lb">เลขผู้เสียภาษีลูกค้า</div><div class="vl">${esc(data.customer!.taxId)}</div></div>` : ""}
${showProject ? `<div class="cell"><div class="lb">Project / Reference</div>${show(data.project) ? `<div class="vl">${esc(data.project)}</div>` : ""}${show(data.reference) ? `<div class="sub">Ref: ${esc(data.reference)}</div>` : ""}</div>` : ""}
</div>` : ""}

<!-- ITEMS -->
<table><thead><tr><th class="c" style="width:30px">ลำดับ</th><th>รายการ</th><th class="c" style="width:45px">จำนวน</th><th class="c" style="width:40px">หน่วย</th><th class="r" style="width:80px">ราคา/หน่วย</th><th class="r" style="width:55px">ส่วนลด</th><th class="r" style="width:85px">จำนวนเงิน</th></tr></thead><tbody>
${data.items.map((x, i) => `<tr><td class="c">${i + 1}</td><td><div class="iname">${esc(x.description)}</div>${show(x.detail) ? `<div class="idesc">${esc(x.detail)}</div>` : ""}</td><td class="c">${x.qty}</td><td class="c">${esc(x.unit)}</td><td class="r">${f(x.unitPrice)}</td><td class="r">${x.discount ? f(x.discount) : ""}</td><td class="r">${f(x.qty * x.unitPrice - (x.discount ?? 0))}</td></tr>`).join("")}
</tbody></table>

<!-- SUMMARY -->
<div class="summ"><div class="summ-r">
<div class="sr"><span>รวม</span><span>${f(subtotal)}</span></div>
${shipping ? `<div class="sr"><span>ค่าขนส่ง</span><span>${f(shipping)}</span></div>` : ""}
${serviceFee ? `<div class="sr"><span>ค่าบริการ</span><span>${f(serviceFee)}</span></div>` : ""}
${discount ? `<div class="sr"><span>ส่วนลด</span><span>-${f(discount)}</span></div>` : ""}
${vat > 0 ? `<div class="sr"><span>VAT ${(vatRate * 100).toFixed(0)}%</span><span>${f(vat)}</span></div>` : ""}
<div class="sr tot"><span>ยอดสุทธิ</span><span>${f(total)}</span></div>
${paid > 0 ? `<div class="sr"><span>ชำระแล้ว</span><span>-${f(paid)}</span></div><div class="sr" style="font-weight:600"><span>คงเหลือ</span><span>${f(remaining)}</span></div>` : ""}
</div></div>

${showEvents ? `<!-- EVENTS -->
<div class="events"><h3>Event Timeline</h3>
${data.events!.map(e => `<div class="ev"><span class="ev-date">${esc(e.date)}</span><span class="ev-action">${esc(e.action)}</span></div>`).join("")}
</div>` : ""}

${showDebt ? `<!-- DEBT -->
<div class="debt"><h3>รายละเอียดหนี้ค้างชำระ</h3>
<div class="dr"><span>เงินต้น</span><span>${f(data.debt!.principal)}</span></div>
<div class="dr"><span>ค่าธรรมเนียม</span><span>${f(data.debt!.fee)}</span></div>
<div class="dr"><span>จำนวนวันค้าง</span><span>${data.debt!.daysOverdue} วัน</span></div>
<div class="dr"><span>อัตราดอกเบี้ย</span><span>${(data.debt!.interestRate * 100).toFixed(0)}% ต่อปี</span></div>
<div class="dr"><span>ดอกเบี้ยสะสม</span><span>${f(data.debt!.interestAccrued)}</span></div>
<div class="dr dtot"><span>ยอดที่ต้องชำระ</span><span>${f(data.debt!.principal + data.debt!.fee + data.debt!.interestAccrued)}</span></div>
</div>` : ""}

${showPayment ? `<!-- PAYMENT -->
<div class="pay"><div class="pay-l">
${show(data.payment!.bank) ? `<div class="bk">${esc(data.payment!.bank)}</div>` : ""}
${show(data.payment!.account) ? `<div>เลขที่ ${esc(data.payment!.account)}</div>` : ""}
${show(data.payment!.accountName) ? `<div>${esc(data.payment!.accountName)}</div>` : ""}
${show(data.payment!.branch) ? `<div>${esc(data.payment!.branch)}</div>` : ""}
</div>${show(data.payment!.dueDate) ? `<div style="text-align:right;font-size:10px"><div>กำหนดชำระ</div><div style="font-weight:700;font-size:13px;color:#22c55e">${esc(data.payment!.dueDate)}</div></div>` : ""}</div>` : ""}

${show(data.notes) ? `<div style="font-size:10px;color:#666;margin-top:8px;white-space:pre-wrap">${esc(data.notes)}</div>` : ""}

${show(data.company?.name) ? `<div class="ftr">${esc(data.company!.name)}${show(data.company!.taxId) ? ` | เลขผู้เสียภาษี ${esc(data.company!.taxId)}` : ""}</div>` : ""}

</body></html>`;

  return { type: data.type, label, docNumber, html, summary: { subtotal, shipping, serviceFee, discount, beforeVat, vat, total, paid, remaining } };
}

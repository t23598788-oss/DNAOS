/**
 * DNA OS Document Engine
 *
 * สร้างเอกสาร 11 ประเภทจากข้อมูล DB อัตโนมัติ
 * ทุกเอกสารใช้ layout เดียวกัน Export PNG/JPG/PDF
 */

export type DocType =
  | "quotation" | "workorder" | "delivery" | "invoice"
  | "billing" | "receipt" | "debt_notice" | "management_fee"
  | "requisition" | "job_summary" | "monthly_summary";

export const DOC_LABELS: Record<DocType, { th: string; en: string; prefix: string }> = {
  quotation:       { th: "ใบเสนอราคา",      en: "QUOTATION",        prefix: "QUO" },
  workorder:       { th: "ใบสั่งงาน",        en: "WORK ORDER",       prefix: "WO" },
  delivery:        { th: "ใบส่งของ",         en: "DELIVERY ORDER",   prefix: "DO" },
  invoice:         { th: "ใบแจ้งหนี้",       en: "INVOICE",          prefix: "INV" },
  billing:         { th: "ใบวางบิล",         en: "BILLING NOTE",     prefix: "BN" },
  receipt:         { th: "ใบรับเงิน",        en: "RECEIPT",          prefix: "REC" },
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

export interface DocData {
  type: DocType;
  docNumber?: string;
  date?: string;
  dueDate?: string;
  credit?: number;
  status?: string;
  customer: {
    name: string;
    contact?: string;
    taxId?: string;
    address?: string;
    phone?: string;
  };
  project?: string;
  reference?: string;
  items: DocItem[];
  shipping?: number;
  serviceFee?: number;
  otherFee?: number;
  discount?: number;
  vatRate?: number;
  paidAmount?: number;
  notes?: string;
  debt?: {
    principal: number;
    fee: number;
    daysOverdue: number;
    interestRate: number;
    interestAccrued: number;
  };
}

export interface DocResult {
  type: DocType;
  label: { th: string; en: string };
  docNumber: string;
  html: string;
  summary: {
    subtotal: number;
    shipping: number;
    serviceFee: number;
    discount: number;
    beforeVat: number;
    vat: number;
    total: number;
    paid: number;
    remaining: number;
  };
}

const COMPANY = {
  name: "DNA OS",
  full: "บริษัท ดีเอ็นเอ โอเอส จำกัด",
  tax: "0405569002851",
  phone: "088-985-4294",
  addr: "435 ม.8 ต.โนนท่อน อ.เมือง จ.ขอนแก่น",
  bank: "ธนาคารกสิกรไทย",
  acct: "230-8-66630-4",
  branch: "สาขา โลตัส ขอนแก่น 2",
  promptpay: "0405569002851",
};

export function generateDoc(data: DocData): DocResult {
  const label = DOC_LABELS[data.type];
  const docNumber = data.docNumber ?? `${label.prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-0001`;
  const date = data.date ?? new Date().toLocaleDateString("th-TH");
  const vatRate = data.vatRate ?? 0.07;

  const subtotal = data.items.reduce((s, i) => s + i.qty * i.unitPrice - (i.discount ?? 0), 0);
  const shipping = data.shipping ?? 0;
  const serviceFee = data.serviceFee ?? 0;
  const otherFee = data.otherFee ?? 0;
  const discount = data.discount ?? 0;
  const beforeVat = subtotal + shipping + serviceFee + otherFee - discount;
  const vat = Math.round(beforeVat * vatRate * 100) / 100;
  const total = beforeVat + vat;
  const paid = data.paidAmount ?? 0;
  const remaining = total - paid;

  const f = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const statusColors: Record<string, string> = {
    draft: "#94a3b8", issued: "#3b82f6", outstanding: "#f59e0b", overdue: "#ef4444", paid: "#22c55e",
  };
  const st = data.status ?? "issued";

  const html = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Sarabun,sans-serif;font-size:13px;color:#1a1a1a;background:#fff;width:800px;padding:24px 28px}
.hdr{display:flex;justify-content:space-between;border-bottom:3px solid #22c55e;padding-bottom:10px;margin-bottom:14px}
.hdr h1{font-size:20px;color:#22c55e;letter-spacing:2px}
.hdr p{font-size:10px;color:#555;line-height:1.5}
.dtype{font-size:16px;font-weight:700;border:2px solid #22c55e;color:#22c55e;padding:3px 14px;display:inline-block}
.dtype-th{font-size:12px;font-weight:600;margin-top:2px}
.badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 10px;margin-top:4px;border-radius:4px;color:#fff;background:${statusColors[st] ?? "#94a3b8"}}
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
.summ{display:flex;justify-content:space-between;margin-bottom:12px}
.summ-l{font-size:10px;color:#666;max-width:50%;line-height:1.6}
.summ-r{width:210px}
.sr{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;border-bottom:1px solid #f3f4f6}
.sr.tot{border-top:2px solid #22c55e;border-bottom:2px solid #22c55e;font-size:14px;font-weight:700;padding:6px 0;margin-top:3px;color:#22c55e}
.debt{border:1.5px solid #ef4444;padding:8px 10px;margin-bottom:12px;background:#fef2f2;border-radius:6px}
.debt h3{font-size:12px;font-weight:700;color:#dc2626;margin-bottom:6px}
.debt .dr{display:flex;justify-content:space-between;padding:2px 0;font-size:11px}
.debt .dtot{font-weight:700;font-size:13px;border-top:1.5px solid #dc2626;padding-top:4px;margin-top:3px}
.pay{border:1px solid #d1d5db;padding:8px 10px;margin-bottom:12px;display:flex;justify-content:space-between;border-radius:6px}
.pay-l{font-size:10px;line-height:1.6}.pay-l .bk{font-weight:700;font-size:12px;color:#22c55e}
.sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:20px;text-align:center}
.sig{border-top:1px solid #999;margin-top:40px;padding-top:4px;font-size:9px}
.ftr{text-align:center;font-size:9px;color:#aaa;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:6px}
</style></head><body>
<div class="hdr">
  <div><h1>${COMPANY.name}</h1><p>${COMPANY.full}<br>${COMPANY.addr}<br>โทร ${COMPANY.phone} | เลขผู้เสียภาษี ${COMPANY.tax}</p></div>
  <div style="text-align:right"><div class="dtype">${label.en}</div><div class="dtype-th">${label.th}</div><div style="font-size:11px;font-weight:600;margin-top:4px">${docNumber}</div><div class="badge">${st.toUpperCase()}</div></div>
</div>
<div class="grid">
  <div class="cell"><div class="lb">ลูกค้า</div><div class="vl">${data.customer.name}</div>${data.customer.contact ? `<div class="sub">ผู้ติดต่อ: ${data.customer.contact}</div>` : ""}${data.customer.address ? `<div class="sub">${data.customer.address}</div>` : ""}${data.customer.phone ? `<div class="sub">โทร ${data.customer.phone}</div>` : ""}</div>
  <div class="cell"><div class="lb">เลขที่เอกสาร</div><div class="vl">${docNumber}</div><div class="sub">วันที่: ${date}</div>${data.dueDate ? `<div class="sub">ครบกำหนด: ${data.dueDate}</div>` : ""}</div>
  <div class="cell"><div class="lb">เลขผู้เสียภาษีลูกค้า</div><div class="vl">${data.customer.taxId ?? "-"}</div></div>
  <div class="cell"><div class="lb">Project / Reference</div><div class="vl">${data.project ?? "-"}</div>${data.reference ? `<div class="sub">Ref: ${data.reference}</div>` : ""}</div>
</div>
<table><thead><tr><th class="c" style="width:30px">ลำดับ</th><th>รายการ</th><th class="c" style="width:45px">จำนวน</th><th class="c" style="width:40px">หน่วย</th><th class="r" style="width:80px">ราคา/หน่วย</th><th class="r" style="width:55px">ส่วนลด</th><th class="r" style="width:85px">จำนวนเงิน</th></tr></thead><tbody>
${data.items.map((x, i) => `<tr><td class="c">${i + 1}</td><td><div class="iname">${x.description}</div>${x.detail ? `<div class="idesc">${x.detail}</div>` : ""}</td><td class="c">${x.qty}</td><td class="c">${x.unit}</td><td class="r">${f(x.unitPrice)}</td><td class="r">${x.discount ? f(x.discount) : "-"}</td><td class="r">${f(x.qty * x.unitPrice - (x.discount ?? 0))}</td></tr>`).join("")}
</tbody></table>
<div class="summ">
  <div class="summ-l"><strong>หมายเหตุ</strong><br>${data.notes ?? `กรุณาชำระภายในกำหนด\nขอบคุณที่ใช้บริการ ${COMPANY.name}`}</div>
  <div class="summ-r">
    <div class="sr"><span>รวมค่าสินค้า/บริการ</span><span>${f(subtotal)}</span></div>
    ${shipping ? `<div class="sr"><span>ค่าขนส่ง</span><span>${f(shipping)}</span></div>` : ""}
    ${serviceFee ? `<div class="sr"><span>ค่าบริการ</span><span>${f(serviceFee)}</span></div>` : ""}
    ${discount ? `<div class="sr"><span>ส่วนลด</span><span>-${f(discount)}</span></div>` : ""}
    <div class="sr"><span>ยอดก่อน VAT</span><span>${f(beforeVat)}</span></div>
    <div class="sr"><span>VAT ${(vatRate * 100).toFixed(0)}%</span><span>${f(vat)}</span></div>
    <div class="sr tot"><span>ยอดสุทธิ</span><span>${f(total)}</span></div>
    ${paid ? `<div class="sr"><span>ชำระแล้ว</span><span>-${f(paid)}</span></div><div class="sr" style="font-weight:600"><span>คงเหลือ</span><span>${f(remaining)}</span></div>` : ""}
  </div>
</div>
${data.debt ? `<div class="debt"><h3>● รายละเอียดหนี้ค้างชำระ</h3>
<div class="dr"><span>เงินต้น</span><span>${f(data.debt.principal)}</span></div>
<div class="dr"><span>ค่าธรรมเนียม</span><span>${f(data.debt.fee)}</span></div>
<div class="dr"><span>จำนวนวันค้าง</span><span>${data.debt.daysOverdue} วัน</span></div>
<div class="dr"><span>อัตราดอกเบี้ย</span><span>${(data.debt.interestRate * 100).toFixed(0)}% ต่อปี (ต้นทบดอก)</span></div>
<div class="dr"><span>ดอกเบี้ยสะสม</span><span>${f(data.debt.interestAccrued)}</span></div>
<div class="dr dtot"><span>ยอดที่ต้องชำระ</span><span>${f(data.debt.principal + data.debt.fee + data.debt.interestAccrued)}</span></div></div>` : ""}
<div class="pay"><div class="pay-l"><div>ชำระเงิน</div><div class="bk">${COMPANY.bank}</div><div>เลขที่ ${COMPANY.acct}</div><div>ชื่อบัญชี ${COMPANY.full}</div><div>${COMPANY.branch}</div><div style="margin-top:3px">PromptPay: ${COMPANY.promptpay}</div></div><div style="text-align:right;font-size:10px">${data.dueDate ? `<div>กำหนดชำระ</div><div style="font-weight:700;font-size:13px;color:#22c55e">${data.dueDate}</div>` : ""}</div></div>
<div class="sigs"><div><div class="sig">ผู้จัดทำ</div></div><div><div class="sig">ผู้อนุมัติ</div></div><div><div class="sig">ผู้รับเอกสาร</div></div></div>
<div class="ftr">${COMPANY.full} | เลขผู้เสียภาษี ${COMPANY.tax} | ${COMPANY.addr} | โทร ${COMPANY.phone}</div>
</body></html>`;

  return {
    type: data.type,
    label,
    docNumber,
    html,
    summary: { subtotal, shipping, serviceFee, discount, beforeVat, vat, total, paid, remaining },
  };
}

export function generateDocNumber(type: DocType): string {
  const d = new Date();
  const prefix = DOC_LABELS[type].prefix;
  return `${prefix}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-0001`;
}

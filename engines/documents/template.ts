/**
 * DNA OS Document Template — STRICT RENDER MODE
 *
 * รับข้อมูลที่คำนวณแล้ว → render HTML
 * ห้ามคำนวณเอง ห้ามเดา ห้าม mock
 * ถ้าไม่มีข้อมูล → ซ่อน section ทั้งก้อน
 */

import { sanitizeHtml } from "@/services/middleware/sanitize";
import type { DocData } from "./engine";

export interface RenderInput {
  data: DocData;
  label: { th: string; en: string };
  summary: {
    subtotal: number;
    shipping: number;
    serviceFee: number;
    discount: number;
    beforeVat: number;
    vat: number;
    vatRate: number;
    total: number;
    paid: number;
    remaining: number;
  };
}

export function renderDocument(input: RenderInput): string {
  const { data, label, summary } = input;
  const { subtotal, shipping, serviceFee, discount, vat, vatRate, total, paid, remaining } = summary;

  const docNumber = data.docNumber ?? "";
  const f = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const show = (v: unknown) => v !== undefined && v !== null && v !== "";
  const esc = (v: string | undefined) => v ? sanitizeHtml(v) : "";

  const st = data.status ?? "";
  const stColor: Record<string, string> = { draft: "#94a3b8", issued: "#3b82f6", outstanding: "#f59e0b", overdue: "#ef4444", paid: "#22c55e" };
  const showCustomer = !!data.customer?.name;
  const showDebt = !!data.debt;
  const showEvents = !!data.events?.length;
  const showPayment = data.paymentRequired === true && !!data.payment;

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Sarabun,sans-serif;font-size:13px;color:#1a1a1a;background:#fff;width:800px;padding:28px 32px}
.hdr{border-bottom:2px solid #1a1a1a;padding-bottom:12px;margin-bottom:16px}
.hdr h1{font-size:18px;font-weight:700;letter-spacing:1px}
.hdr-sub{font-size:10px;color:#555;margin-top:2px}
.doc-info{display:flex;justify-content:space-between;margin-bottom:16px}
.doc-info .dtype{font-size:15px;font-weight:700;border:2px solid #1a1a1a;padding:3px 14px;display:inline-block}
.doc-info .dtype-th{font-size:11px;font-weight:600;margin-top:2px}
.badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 10px;margin-top:4px;border-radius:4px;color:#fff;background:${stColor[st] ?? "#94a3b8"}}
.cust{margin-bottom:16px;padding:10px 0;border-bottom:1px solid #e5e7eb}
.cust .lb{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.6px}
.cust .vl{font-size:13px;font-weight:600;margin-top:2px}
.cust .sub{font-size:10px;color:#666;margin-top:1px}
.items{margin-bottom:16px}
.item{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6}
.item:last-child{border-bottom:1px solid #d1d5db}
.item-desc{font-size:12px;font-weight:500}
.item-detail{font-size:10px;color:#666;margin-top:1px}
.item-amt{font-size:12px;font-weight:600;text-align:right;min-width:120px}
.summ{margin-bottom:16px}
.sr{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}
.sr.tot{border-top:2px solid #1a1a1a;font-size:16px;font-weight:700;padding:8px 0;margin-top:4px}
.debt{border:1.5px solid #333;padding:12px 14px;margin-bottom:16px;border-radius:6px}
.debt h3{font-size:12px;font-weight:700;margin-bottom:8px}
.debt .dr{display:flex;justify-content:space-between;padding:3px 0;font-size:11px}
.debt .dtot{font-weight:700;font-size:14px;border-top:1.5px solid #333;padding-top:6px;margin-top:4px}
.events{margin-bottom:16px;padding:10px;border:1px solid #e5e7eb;border-radius:6px}
.events h3{font-size:10px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
.ev{display:flex;gap:12px;font-size:11px;padding:3px 0;border-bottom:1px solid #f3f4f6}
.ev:last-child{border:none}
.ev-date{color:#888;min-width:120px}.ev-action{font-weight:500}
.pay{border:1px solid #d1d5db;padding:10px;margin-bottom:12px;border-radius:6px}
.pay .bk{font-weight:700;font-size:12px}
.ftr{text-align:center;font-size:9px;color:#aaa;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:8px}
</style></head><body>

<!-- HEADER -->
<div class="hdr">
${show(data.company?.name) ? `<h1>${esc(data.company!.name)}</h1>` : ""}
${show(data.company?.taxId) ? `<div class="hdr-sub">เลขผู้เสียภาษี ${esc(data.company!.taxId)}</div>` : ""}
</div>

<!-- DOC INFO -->
<div class="doc-info">
<div>${showCustomer ? `<div class="cust"><div class="lb">ลูกค้า</div><div class="vl">${esc(data.customer!.name)}</div>${show(data.customer!.phone) ? `<div class="sub">${esc(data.customer!.phone)}</div>` : ""}${show(data.customer!.address) ? `<div class="sub">${esc(data.customer!.address)}</div>` : ""}</div>` : ""}</div>
<div style="text-align:right"><div class="dtype">${label.en}</div><div class="dtype-th">${label.th}</div>${show(docNumber) ? `<div style="font-size:11px;font-weight:600;margin-top:4px">${esc(docNumber)}</div>` : ""}${show(st) ? `<div class="badge">${esc(st.toUpperCase())}</div>` : ""}${show(data.date) ? `<div style="font-size:10px;color:#888;margin-top:2px">${esc(data.date)}</div>` : ""}</div>
</div>

<!-- ITEMS -->
<div class="items">
${data.items.map(x => `<div class="item"><div><div class="item-desc">${esc(x.description)}</div>${show(x.detail) ? `<div class="item-detail">${esc(x.detail)}</div>` : ""}</div><div class="item-amt">${f(x.qty * x.unitPrice - (x.discount ?? 0))} บาท</div></div>`).join("")}
</div>

<!-- SUMMARY -->
<div class="summ">
${shipping ? `<div class="sr"><span>ค่าขนส่ง</span><span>${f(shipping)}</span></div>` : ""}
${serviceFee ? `<div class="sr"><span>ค่าบริการ</span><span>${f(serviceFee)}</span></div>` : ""}
${discount ? `<div class="sr"><span>ส่วนลด</span><span>-${f(discount)}</span></div>` : ""}
${vat > 0 ? `<div class="sr"><span>ภาษีมูลค่าเพิ่ม ${(vatRate * 100).toFixed(0)}%</span><span>${f(vat)}</span></div>` : ""}
${paid > 0 ? `<div class="sr"><span>ชำระแล้ว</span><span>-${f(paid)}</span></div>` : ""}
<div class="sr tot"><span>ยอดรวมสุทธิที่ต้องชำระ</span><span>${f(total)} บาท</span></div>
</div>

${showDebt ? `<!-- DEBT -->
<div class="debt"><h3>รายละเอียดค้างชำระ</h3>
<div class="dr"><span>เงินต้น</span><span>${f(data.debt!.principal)} บาท</span></div>
<div class="dr"><span>ค่าธรรมเนียม</span><span>${f(data.debt!.fee)} บาท</span></div>
<div class="dr"><span>จำนวนวันคิดดอกเบี้ย</span><span>${data.debt!.daysOverdue} วัน</span></div>
<div class="dr"><span>ดอกเบี้ย ${(data.debt!.interestRate * 100).toFixed(0)}% ต่อปี</span><span>${f(data.debt!.interestAccrued)} บาท</span></div>
${show(data.debt!.defaultDate) ? `<div class="dr"><span>วันที่ผิดนัดชำระ</span><span>${esc(data.debt!.defaultDate)}</span></div>` : ""}
${data.debt!.penalty ? `<div class="dr"><span>ค่าปรับ/ค่าติดตามทวงถาม</span><span>${f(data.debt!.penalty)} บาท</span></div>` : ""}
${vat > 0 ? `<div class="dr"><span>ภาษีมูลค่าเพิ่ม</span><span>${f(vat)} บาท</span></div>` : ""}
<div class="dr dtot"><span>ยอดที่ต้องชำระปัจจุบัน</span><span>${f(data.debt!.principal + data.debt!.fee + data.debt!.interestAccrued + (data.debt!.penalty ?? 0) + vat)} บาท</span></div>
</div>` : ""}

${showEvents ? `<!-- EVENTS -->
<div class="events"><h3>ประวัติรายการ</h3>
${data.events!.map(e => `<div class="ev"><span class="ev-date">${esc(e.date)}</span><span class="ev-action">${esc(e.action)}</span></div>`).join("")}
</div>` : ""}

${showPayment ? `<!-- PAYMENT -->
<div class="pay">
${show(data.payment!.bank) ? `<div class="bk">${esc(data.payment!.bank)}</div>` : ""}
${show(data.payment!.account) ? `<div style="font-size:10px">เลขที่ ${esc(data.payment!.account)}</div>` : ""}
${show(data.payment!.accountName) ? `<div style="font-size:10px">${esc(data.payment!.accountName)}</div>` : ""}
${show(data.payment!.dueDate) ? `<div style="font-size:10px;margin-top:4px">กำหนดชำระ <strong>${esc(data.payment!.dueDate)}</strong></div>` : ""}
</div>` : ""}

${show(data.notes) ? `<div style="font-size:10px;color:#666;margin-top:8px;white-space:pre-wrap">${esc(data.notes)}</div>` : ""}

<div class="ftr">${show(data.company?.name) ? `${esc(data.company!.name)}` : "DNA OS"}${show(data.company?.taxId) ? ` | เลขผู้เสียภาษี ${esc(data.company!.taxId)}` : ""}</div>

</body></html>`;
}

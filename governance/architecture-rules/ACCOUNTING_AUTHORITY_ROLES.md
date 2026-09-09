# ACCOUNTING_AUTHORITY_ROLES

Owner, 2026-09-05 — TASK: CONSOLIDATE_ACCOUNTING_INTO_SINGLE_REGISTERED_CAPABILITY
ต่อจาก `ACCOUNTING_CANONICAL_TRUTH.md` (2026-09-02) ซึ่งยังมีผลทุกข้อ ไฟล์นี้ไม่แก้คำตัดสินเดิม
เพียงระบุบทบาทของส่วนที่เหลือให้ครบ ตาม Phase 7 "เปลี่ยนบทบาทก่อน ห้ามรีบลบ"

## ทางเข้าเดียว
`control/accounting-capability/contract.ts` คือขอบเดียวของงานบัญชี
ระบบอื่นห้ามเรียก kernel ตรง และห้ามรู้ชื่อตารางภายใน kernel

## บทบาทหลังรวมศูนย์ (ยังไม่ลบข้อมูลใด)

| ส่วน | บทบาท | มีอำนาจคำนวณบัญชีไหม |
|---|---|---|
| DNA OS Accounting Kernel | ACCOUNTING CORE | ใช่ — ตัวเดียวในระบบ |
| `control/accounting-capability/calculation.ts` | DOCUMENT CALCULATION | คำนวณยอดเอกสารเท่านั้น ไม่แตะ ledger |
| `invoices` / `standalone_documents` | DOCUMENT LAYER | ไม่ |
| `invoice_items` | SOURCE DATA | ไม่ |
| `company_expenses` | SOURCE DATA | ไม่ |
| `partner_payable_requests` | SOURCE DATA | ไม่ |
| `bank_statement_transactions` / `receipt_documents` | PAYMENT LAYER (หลักฐาน) | ไม่ |
| `business_events` | SOURCE DATA | ไม่ |
| `debt_events` | FEEDER | ไม่ |
| `debt_snapshots` | DERIVED / CACHE เท่านั้น | ไม่ |
| `invoices.paid_amount` · `invoice_status` | OPERATIONAL PROJECTION | ไม่ |
| `app/api/admin/finance-summary` | READ PROJECTION | ไม่ |
| `control/finance-pipeline/` | ORCHESTRATION / READ | ไม่ |

## ข้อห้าม
- ห้ามมีจุดคำนวณ accounting truth สองแห่ง ถ้าของเดิมต้องใช้ต่อ ให้ทำ projection/adapter
- ห้าม adapter คำนวณ debit/credit, VAT หรือ outstanding เอง
- ห้ามฝังชื่อ provider/ระบบไว้ใน routing — ค้นผ่าน capability registry เท่านั้น

## ที่ยังไม่เสร็จ (ประกาศไว้ ไม่ซ่อน)
สูตร VAT ในโค้ด production ของ deadboard ยังมีอยู่สี่จุด และยังไม่ถูกรวม:
`engines/tax.ts` (canonical) · `engines/pricing.ts:45` (ฝัง 0.07)
`engines/documents/engine.ts:51` · `engines/validation/dispatcher.ts:223`
ตราบใดที่สามจุดหลังยังคำนวณเอง **ยังประกาศ COMPLETE ไม่ได้**

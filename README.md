# DNA OS — Dead Board (V1)

Command → Router → Supabase → Result Viewer
Command → Siri Shortcut → LINE
จากหน้าจอเดียว: `/deadboard`

## Run
```bash
npm install
cp .env.local.example .env.local   # ใส่ค่า Supabase
npm run dev
```

## Flow
1. พิมพ์คำสั่งไทยใน CommandBox เช่น "ลูกหนี้ทั้งหมด"
2. router/index.ts -> parseCommand() -> Command Object
3. dispatch() -> handler ตาม domain (debt/invoice/document/line)
4. handler เรียก supabase/queries.ts หรือ siri/shortcuts.ts
5. ResultViewer แสดงผล (JSON / Table / Text)

## คำสั่งที่รองรับ V1
- ลูกหนี้ทั้งหมด        → debt.list
- ใบแจ้งหนี้ล่าสุด       → invoice.latest
- ส่งใบแจ้งหนี้ล่าสุด    → invoice.send_latest
- เปิด LINE            → line.open
- เปิด Drive          → drive.open

## Supabase tables ที่ต้องมี
- debts, invoices, documents (มีคอลัมน์ created_at)
- invoices ต้องมี: invoice_no, amount, contact

## Siri Shortcuts ที่ต้องสร้างบน iOS
- ชื่อ "SendLine" รับ input {contact, message}

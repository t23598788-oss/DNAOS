# ผลกระทบทางการเงิน

> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ

| effect | ชนิด | คำสั่งต้นทาง | ที่มาของจำนวนเงิน | สูตร | บัญชีที่กระทบ | ย้อนได้ |
| --- | --- | --- | --- | --- | --- | --- |
| fe.invoice.revenue | REVENUE | ISSUE_INVOICE | dc.document.issued.v1#total | engines/documents/artifact.ts:133-136 | invoices, standalone_documents | ไม่ได้ |
| fe.invoice.tax | TAX | ISSUE_INVOICE | dc.document.issued.v1#vat | engines/documents/artifact.ts:134 | invoices | ไม่ได้ |
| fe.debt.created | DEBT | ISSUE_INVOICE | dc.document.issued.v1#total | supabase/functions/line-webhook-v2/engines/auto-confirm-payment.ts:130 | debt_events | ได้ |
| fe.payment.in | PAYMENT_IN | MATCH_PAYMENT | dc.payment.claim.v1#amount | supabase/functions/line-webhook-v2/engines/payment-claim.ts:35 | receipt_documents | ได้ |
| fe.debt.settled | SETTLEMENT | MATCH_PAYMENT | dc.payment.match_result.v1#amount_applied | supabase/functions/line-webhook-v2/engines/auto-confirm-payment.ts:120 | debt_snapshots, debt_events | ได้ |
| fe.quote.revenue_projected | REVENUE | CALCULATE_PRICE | dc.pricing.quote_result.v1#grand_total | engines/quote-price.ts:290 | business_events | ได้ |
| fe.payable.created | PAYABLE | (postback ในแชท) | UNKNOWN — ไม่มี schema ที่ประกาศไว้ | supabase/functions/line-webhook-v2/handlers/postback.ts | partner_payable_requests | ได้ |
| fe.maintenance.cost | COST | RECORD_EQUIPMENT_TELEMETRY | UNKNOWN — ใบแจ้งซ่อมยังไม่ผูกจำนวนเงิน | engines/equipment/engine-hours.ts:42 | maintenance_tickets | ได้ |

## ค่าที่คำนวณได้

| ค่า | อินพุต | การคำนวณ | คำนวณใหม่เมื่อ | นโยบายแคช |
| --- | --- | --- | --- | --- |
| debt_snapshots | debt_events | supabase/functions/line-webhook-v2/engines/auto-confirm-payment.ts:61-120 | เมื่อมี debt_events ใหม่ | เก็บยอดล่าสุดหนึ่งแถวต่อบริษัท |
| quote_result.grand_total | material_types, pit_materials, vehicle_types, fuel_price_log, dc.geo.distance_result.v1 | engines/quote-price.ts:243,289,290 (materialTotal = unitPrice * qty · transportTotal = transportCostPerTrip * trips · grandTotal = ผลรวม) | ทุกครั้งที่มีคำขอราคา ไม่เก็บผลไว้ | ไม่แคช |
| distance_km | dc.geo.coordinate_pair.v1 | engines/quote-price.ts:12-30 haversine ในเครื่อง | ทุกครั้งที่คิดราคา | ไม่แคช |
| engine_hours_total | equipment_telemetry_pings | engines/equipment/engine-hours.ts:42,77 พร้อม MAX_GAP_HOURS = 0.5 | ทุก ping ที่เข้ามา | สะสมไว้ในแถว equipment_assets |
| document_totals | dc.document.issue_request.v1 | engines/documents/artifact.ts:133-136 ยอดก่อนภาษี ภาษี ยอดสุทธิ | ตอนออกเอกสาร | เก็บลงแถวเอกสารเพราะเป็นตัวเลขที่ออกไปแล้วตามกฎหมาย |

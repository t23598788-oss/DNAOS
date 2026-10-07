# เหตุการณ์

> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ

| event | ช่อง | ผู้ผลิต | ผู้บริโภค | การส่ง | ลำดับ | คีย์กันซ้ำ |
| --- | --- | --- | --- | --- | --- | --- |
| MESSAGE_RECEIVED | line.inbound | u.line-ingest | u.chat-response, u.image-classify | AT_LEAST_ONCE | ORDERED | line_event_id |
| PRICE_CALCULATED | business.pricing | u.quote-price | u.chat-response | AT_LEAST_ONCE | UNORDERED | - |
| INVOICE_ISSUED | business.documents | u.document-issuance | u.payment-matching | AT_LEAST_ONCE | UNORDERED | document_id |
| PAYMENT_MATCHED | business.finance | u.payment-matching | ไม่มี | AT_LEAST_ONCE | ORDERED | debt_event_id |
| RECEIPT_CLASSIFIED | business.documents | u.image-classify | u.payment-matching | AT_MOST_ONCE | UNORDERED | - |
| SITE_REGISTERED | business.geo | u.site-location | u.quote-price | AT_LEAST_ONCE | UNORDERED | - |
| TELEMETRY_RECORDED | device.equipment | u.equipment-telemetry | u.equipment-access | AT_LEAST_ONCE | ORDERED | imei+recorded_at |
| EQUIPMENT_LOCKED | device.equipment | u.equipment-access | ไม่มี | AT_LEAST_ONCE | ORDERED | equipment_id+action |
| AUTHORIZATION_REQUESTED | identity.authorization | u.authorization | ไม่มี | AT_LEAST_ONCE | UNORDERED | - |
| PROFILE_REFRESH_REQUESTED | identity.profile | u.line-profile | line-profile-refresh-worker | AT_LEAST_ONCE | UNORDERED | line_user_id |

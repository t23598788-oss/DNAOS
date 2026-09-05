# ที่อยู่จริงของแต่ละ unit

> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ

| unit | ที่รัน | จุดเข้า | สิทธิ์ที่ต้องมี |
| --- | --- | --- | --- |
| u.line-ingest | supabase edge function line-webhook-v2 | supabase/functions/line-webhook-v2/index.ts | - |
| u.identity-context | supabase edge function | supabase/functions/line-webhook-v2/engines/authorization-check.ts | - |
| u.quote-price | supabase edge function | engines/quote-price.ts | - |
| u.distance | in-process | engines/quote-price.ts#haversine | - |
| u.document-issuance | deadboard next.js | app/api/admin/documents/route.ts#POST | ADMIN_TIER |
| u.payment-matching | supabase edge function | supabase/functions/line-webhook-v2/engines/auto-confirm-payment.ts#tryAutoConfirmPayment | - |
| u.image-classify | supabase edge function | supabase/functions/line-webhook-v2/engines/ocr-classify.ts#classifyReceiptImage | - |
| u.site-location | supabase edge function | supabase/functions/line-webhook-v2/handlers/location.ts | - |
| u.equipment-telemetry | deadboard next.js | app/api/internal/equipment/telemetry/route.ts#POST | MACHINE_SECRET |
| u.equipment-access | deadboard next.js | app/api/internal/equipment/lock-command/route.ts#POST | MACHINE_SECRET, ADMIN_TIER |
| u.chat-response | supabase edge function | supabase/functions/line-webhook-v2/handlers/text.ts | - |
| u.line-profile | supabase edge function | supabase/functions/line-webhook-v2/engines/profile-refresh.ts#ensureFreshLineProfile | - |
| u.authorization | supabase edge function | supabase/functions/line-webhook-v2/engines/authorization-check.ts#requestAuthorization | - |
| u.document-autofill | deadboard next.js | engines/documents/draft-builders.ts#buildDraftFromPartner | ADMIN_TIER |

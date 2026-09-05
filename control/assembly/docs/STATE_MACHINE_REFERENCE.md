# วงจรชีวิตของสิ่งต่าง ๆ

> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ

## sm.authorization.lifecycle — pending_authorizations

| จาก | ไป | ตัวกระตุ้น | ผู้ทำ | สิทธิ์ | โค้ดที่รับผิดชอบ |
| --- | --- | --- | --- | --- | --- |
| (none) | pending | ผู้ใช้ขอสิทธิ์หน้างานที่ไม่ใช่ของบริษัทตน | ผู้ใช้ LINE | NONE | supabase/functions/line-webhook-v2/engines/authorization-check.ts:60 |
| pending | approved | เจ้าของบริษัทอนุมัติ | ผู้ใช้ LINE ของบริษัทเจ้าของ | NONE | **ไม่มี** |
| pending | denied | เจ้าของบริษัทปฏิเสธ | ผู้ใช้ LINE ของบริษัทเจ้าของ | NONE | **ไม่มี** |
| pending | expired | หมดอายุตามเวลา | ระบบ | NONE | **ไม่มี** |

## sm.equipment.lifecycle — equipment_assets.current_status

| จาก | ไป | ตัวกระตุ้น | ผู้ทำ | สิทธิ์ | โค้ดที่รับผิดชอบ |
| --- | --- | --- | --- | --- | --- |
| LOCKED | UNLOCKED | แอดมินสั่งสตาร์ต | แอดมิน | ADMIN_TIER | app/api/admin/equipment/trigger-start/route.ts:54 |
| UNLOCKED | RUNNING | กล่องรายงานว่าเครื่องยนต์ทำงาน | กล่องฮาร์ดแวร์ | MACHINE_SECRET | app/api/internal/equipment/telemetry/route.ts:80 |
| RUNNING | LOCKED | งานเบื้องหลังสั่งล็อก | งานเบื้องหลัง | MACHINE_SECRET | app/api/internal/equipment/lock-command/route.ts:64 |
| UNLOCKED | LOCKED | ถอนสิทธิ์คนขับ | แอดมิน | ADMIN_TIER | app/api/admin/equipment/toggle-permission/route.ts:47 |

## sm.conversation.mode — line_conversation_controls.mode

| จาก | ไป | ตัวกระตุ้น | ผู้ทำ | สิทธิ์ | โค้ดที่รับผิดชอบ |
| --- | --- | --- | --- | --- | --- |
| ai | human_takeover | ข้อความเข้าเกณฑ์การขอคุยกับคน | ผู้ใช้ LINE หรือทีมงาน | NONE | supabase/functions/line-webhook-v2/engines/human-takeover.ts:20 |
| human_takeover | ai | คืนโหมดอัตโนมัติ | UNKNOWN | NONE | **ไม่มี** |

## sm.debt.lifecycle — debt_snapshots

| จาก | ไป | ตัวกระตุ้น | ผู้ทำ | สิทธิ์ | โค้ดที่รับผิดชอบ |
| --- | --- | --- | --- | --- | --- |
| OPEN | PARTIALLY_SETTLED | รับชำระบางส่วน | ระบบ | NONE | supabase/functions/line-webhook-v2/engines/auto-confirm-payment.ts:120,130 |
| PARTIALLY_SETTLED | SETTLED | รับชำระส่วนที่เหลือ | ระบบ | NONE | supabase/functions/line-webhook-v2/engines/auto-confirm-payment.ts:120 |
| OPEN | SETTLED | รับชำระเต็มจำนวน | ระบบ | NONE | supabase/functions/line-webhook-v2/engines/auto-confirm-payment.ts:120 |

## sm.document.lifecycle — invoices · standalone_documents

| จาก | ไป | ตัวกระตุ้น | ผู้ทำ | สิทธิ์ | โค้ดที่รับผิดชอบ |
| --- | --- | --- | --- | --- | --- |
| DRAFT | ISSUED | แอดมินยืนยันออกเอกสาร | แอดมิน | ADMIN_TIER | app/api/admin/documents/route.ts:181,202 |
| ISSUED | DELIVERED | ส่งเอกสารเข้าแชทลูกค้า | แอดมิน | ADMIN_TIER | app/api/admin/line-customers/[lineUserId]/send-document/route.ts:97 |
| DELIVERED | CONFIRMED | ยืนยันเอกสาร | แอดมิน | ADMIN_TIER | app/api/admin/documents/[id]/confirm/route.ts |

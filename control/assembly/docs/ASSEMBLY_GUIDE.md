# คู่มือการประกอบ

> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ

ลำดับที่ระบบใช้: REQUIREMENT → CAPABILITY LOOKUP → PORT MATCHING → CONTRACT VALIDATION → RESOURCE BINDING → FLOW PLAN → EXECUTION → VERIFICATION

เรียกใช้: `planAssembly(capabilities, context)` แล้วส่งผลเข้า `link(plan, context)` ถ้าได้ LINKABLE จึงเรียก `buildExecutionManifest` — ทั้งสามขั้นไม่มีการเรียกโมเดลภาษา

## สัญญาข้อมูลที่ประกาศไว้

| schema_id | entity | เวอร์ชัน | ตัวตน | ต้นทางความจริง |
| --- | --- | --- | --- | --- |
| dc.line.inbound_message.v1 | LineInboundMessage | 1.0 | ENTITY | line_events |
| dc.identity.company_context.v1 | CompanyContext | 1.0 | ENTITY | company_line_links |
| dc.pricing.quote_request.v1 | QuoteRequest | 1.0 | ENTITY | business_events |
| dc.pricing.quote_result.v1 | QuoteResult | 1.0 | ENTITY | engines/quote-price.ts:290 |
| dc.geo.coordinate_pair.v1 | CoordinatePair | 1.0 | VALUE_OBJECT | customer_sites · pit_profiles |
| dc.geo.distance_result.v1 | DistanceResult | 1.0 | VALUE_OBJECT | engines/quote-price.ts:12-30 |
| dc.document.issue_request.v1 | DocumentIssueRequest | 1.0 | ENTITY | invoices · standalone_documents |
| dc.document.issued.v1 | IssuedDocument | 1.0 | ENTITY | engines/documents/artifact.ts:140 |
| dc.payment.claim.v1 | PaymentClaim | 1.0 | ENTITY | receipt_documents |
| dc.payment.match_result.v1 | PaymentMatchResult | 1.0 | ENTITY | debt_events · debt_snapshots |
| dc.profile.refresh_request.v1 | ProfileRefreshRequest | 1.0 | ENTITY | line_profile_refresh_queue |
| dc.profile.snapshot.v1 | LineProfileSnapshot | 1.0 | ENTITY | supabase/functions/line-webhook-v2/engines/profile-refresh.ts:37 |
| dc.site.location_capture.v1 | SiteLocationCapture | 1.0 | ENTITY | customer_sites |
| dc.equipment.telemetry_ping.v1 | EquipmentTelemetryPing | 1.0 | ENTITY | equipment_telemetry_pings |
| dc.equipment.engine_hours.v1 | EngineHoursResult | 1.0 | ENTITY | equipment_assets |
| dc.equipment.control_command.v1 | EquipmentControlCommand | 1.0 | ENTITY | equipment_assets |
| dc.image.classified_receipt.v1 | ClassifiedReceipt | 1.0 | VALUE_OBJECT | supabase/functions/line-webhook-v2/engines/ocr-classify.ts:115 |
| dc.authorization.site_request.v1 | SiteAuthorizationRequest | 1.0 | ENTITY | pending_authorizations |
| dc.chat.outbound_message.v1 | ChatOutboundMessage | 1.0 | ENTITY | supabase/functions/line-webhook-v2/engines/response.ts:95 |

## สายที่ต่อไว้แล้ว

| connection | จาก | ไป | สถานะ |
| --- | --- | --- | --- |
| cx.p.distance.result.out->p.price.calculate.in | p.distance.result.out | p.price.calculate.in | ACTIVE |
| cx.p.identity.context.out->p.price.calculate.in | p.identity.context.out | p.price.calculate.in | ACTIVE |
| cx.p.identity.context.out->p.document.issue.in | p.identity.context.out | p.document.issue.in | ADAPTER_REQUIRED |
| cx.p.identity.context.out->p.payment.claim.in | p.identity.context.out | p.payment.claim.in | ACTIVE |
| cx.p.identity.context.out->p.site.capture.in | p.identity.context.out | p.site.capture.in | ACTIVE |
| cx.p.identity.context.out->p.authorization.request.in | p.identity.context.out | p.authorization.request.in | ACTIVE |
| cx.p.identity.context.out->p.chat.decide.in | p.identity.context.out | p.chat.decide.in | ACTIVE |

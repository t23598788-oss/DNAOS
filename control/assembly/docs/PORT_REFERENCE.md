# ช่องต่อของแต่ละ unit

> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ

| port | unit | ทิศทาง | ช่องทาง | เข้า | ออก | สิทธิ์ | สถานะ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| p.line.webhook.in | u.line-ingest | IN | WEBHOOK | - | dc.line.inbound_message.v1 | NONE | READY |
| p.line.event.out | u.line-ingest | OUT | EVENT | - | dc.line.inbound_message.v1 | NONE | READY |
| p.identity.resolve.in | u.identity-context | IN | FUNCTION | dc.line.inbound_message.v1 | dc.identity.company_context.v1 | NONE | READY |
| p.identity.context.out | u.identity-context | OUT | FUNCTION | - | dc.identity.company_context.v1 | NONE | READY |
| p.price.calculate.in | u.quote-price | IN | FUNCTION | dc.pricing.quote_request.v1 | dc.pricing.quote_result.v1 | NONE | READY |
| p.price.result.out | u.quote-price | OUT | FUNCTION | - | dc.pricing.quote_result.v1 | NONE | READY |
| p.distance.calculate.in | u.distance | IN | FUNCTION | dc.geo.coordinate_pair.v1 | dc.geo.distance_result.v1 | NONE | READY |
| p.distance.result.out | u.distance | OUT | FUNCTION | - | dc.geo.distance_result.v1 | NONE | READY |
| p.document.issue.in | u.document-issuance | IN | HTTP | dc.document.issue_request.v1 | dc.document.issued.v1 | ADMIN_TIER | READY |
| p.document.issued.out | u.document-issuance | OUT | EVENT | - | dc.document.issued.v1 | ADMIN_TIER | READY |
| p.document.deliver.out | u.document-issuance | OUT | HTTP | dc.document.issued.v1 | dc.chat.outbound_message.v1 | ADMIN_TIER | READY |
| p.payment.claim.in | u.payment-matching | IN | FUNCTION | dc.payment.claim.v1 | dc.payment.match_result.v1 | NONE | READY |
| p.payment.matched.out | u.payment-matching | OUT | EVENT | - | dc.payment.match_result.v1 | NONE | READY |
| p.payment.notify.out | u.payment-matching | OUT | HTTP | dc.payment.match_result.v1 | dc.chat.outbound_message.v1 | NONE | READY |
| p.image.classify.in | u.image-classify | IN | FUNCTION | - | dc.image.classified_receipt.v1 | NONE | READY |
| p.image.classified.out | u.image-classify | OUT | EVENT | - | dc.image.classified_receipt.v1 | NONE | READY |
| p.site.capture.in | u.site-location | IN | FUNCTION | dc.site.location_capture.v1 | dc.site.location_capture.v1 | NONE | READY |
| p.site.geocode.out | u.site-location | OUT | HTTP | - | dc.site.location_capture.v1 | NONE | UNAVAILABLE |
| p.equipment.telemetry.in | u.equipment-telemetry | IN | HTTP | dc.equipment.telemetry_ping.v1 | dc.equipment.engine_hours.v1 | MACHINE_SECRET | READY |
| p.equipment.hours.out | u.equipment-telemetry | OUT | EVENT | - | dc.equipment.engine_hours.v1 | NONE | READY |
| p.equipment.control.in | u.equipment-access | IN | HTTP | dc.equipment.control_command.v1 | - | MACHINE_SECRET | READY |
| p.profile.refresh.in | u.line-profile | IN | FUNCTION | dc.profile.refresh_request.v1 | dc.profile.snapshot.v1 | NONE | UNAVAILABLE |
| p.profile.snapshot.out | u.line-profile | OUT | FUNCTION | - | dc.profile.snapshot.v1 | NONE | PARTIAL |
| p.authorization.request.in | u.authorization | IN | FUNCTION | dc.authorization.site_request.v1 | dc.authorization.site_request.v1 | NONE | READY |
| p.chat.reply.out | u.chat-response | OUT | HTTP | dc.chat.outbound_message.v1 | - | NONE | READY |
| p.chat.decide.in | u.chat-response | IN | FUNCTION | dc.line.inbound_message.v1 | dc.chat.outbound_message.v1 | NONE | READY |
| p.document.autofill.in | u.document-autofill | IN | FUNCTION | - | dc.document.issue_request.v1 | ADMIN_TIER | UNAVAILABLE |

# สายธุรกิจ

> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ

| unit | ชื่อ | โดเมน | ให้ความสามารถ | ต้องพึ่ง | ทรัพยากร | ความพร้อม |
| --- | --- | --- | --- | --- | --- | --- |
| u.line-ingest | รับข้อความเข้าจาก LINE | communication | line.message.ingest | - | supabase, line | AVAILABLE |
| u.identity-context | ระบุบริษัทและสิทธิ์ของผู้ใช้ LINE | identity | identity.company.resolve, identity.site.ownership | - | supabase | AVAILABLE |
| u.quote-price | คำนวณราคาวัสดุพร้อมค่าขนส่ง | pricing | pricing.quote.calculate | geo.distance.calculate, identity.company.resolve | supabase | AVAILABLE |
| u.distance | คำนวณระยะทางระหว่างสองพิกัด | geo | geo.distance.calculate | - | - | AVAILABLE |
| u.document-issuance | ออกเอกสารการค้าและส่งให้ลูกค้า | documents | document.issue, document.deliver | identity.company.resolve | supabase, company-settings, line | AVAILABLE |
| u.payment-matching | จับคู่การชำระเงินกับหนี้คงค้าง | finance | payment.claim.record, payment.match | identity.company.resolve | supabase, line | AVAILABLE |
| u.image-classify | อ่านรูปเอกสารและจำแนกชนิด | documents | image.receipt.classify | - | ai-provider, supabase | AVAILABLE |
| u.site-location | บันทึกพิกัดหน้างาน | geo | site.location.capture | identity.company.resolve | supabase | DEGRADED |
| u.equipment-telemetry | รับสัญญาณเครื่องจักรและสะสมชั่วโมง | equipment | equipment.telemetry.record, equipment.hours.accumulate | - | supabase | AVAILABLE |
| u.equipment-access | ควบคุมสิทธิ์และสั่งล็อกเครื่องจักร | equipment | equipment.control, equipment.permission.grant | - | supabase, line | AVAILABLE |
| u.chat-response | ตัดสินและส่งคำตอบกลับในแชท | communication | chat.response.decide, chat.reply.send | identity.company.resolve | line, supabase | AVAILABLE |
| u.line-profile | ดูแลความสดของโปรไฟล์ LINE | identity | profile.snapshot.read, profile.refresh.request | - | supabase, line | DEGRADED |
| u.authorization | ขออนุมัติสิทธิ์หน้างาน | identity | authorization.site.request | identity.site.ownership | supabase | AVAILABLE |
| u.document-autofill | เติมข้อมูลเอกสารจากข้อมูลเดิม | documents | document.autofill | - | supabase | UNAVAILABLE |

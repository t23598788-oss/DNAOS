# คำสั่งทางธุรกิจ

> สร้างอัตโนมัติจาก control/assembly/data — ห้ามแก้ด้วยมือ

| command | เจตนา | ต้องส่ง | ผลที่ได้ | เหตุการณ์ที่ตามมา | บทบาทที่เรียกได้ | ผลข้างเคียง |
| --- | --- | --- | --- | --- | --- | --- |
| CALCULATE_PRICE | คำนวณราคาวัสดุพร้อมค่าขนส่ง | company_id, material_code, quantity, unit | dc.pricing.quote_result.v1 | PRICE_CALCULATED | CUSTOMER, STAFF, OWNER | READ_ONLY |
| ISSUE_INVOICE | ออกใบแจ้งหนี้และส่งให้ลูกค้า | document_type, company_id, items | dc.document.issued.v1 | INVOICE_ISSUED | STAFF, OWNER | FINANCIAL |
| MATCH_PAYMENT | จับคู่การชำระเงินกับหนี้คงค้าง | company_id, amount, claimed_at, currency | dc.payment.match_result.v1 | PAYMENT_MATCHED | CUSTOMER, STAFF, OWNER | FINANCIAL |
| LINK_COMPANY | ตรวจว่าผู้ใช้ LINE ผูกกับบริษัทไหน | line_user_id | dc.identity.company_context.v1 | - | STAFF, OWNER | READ_ONLY |
| REGISTER_SITE_LOCATION | บันทึกพิกัดหน้างานของลูกค้า | company_id, address, capture_method | dc.site.location_capture.v1 | SITE_REGISTERED | CUSTOMER, STAFF, OWNER | LOCAL_WRITE |
| CLASSIFY_RECEIPT_IMAGE | อ่านรูปเอกสารและจำแนกชนิด | image_ref | dc.image.classified_receipt.v1 | RECEIPT_CLASSIFIED | CUSTOMER, STAFF, OWNER | LOCAL_WRITE |
| RECORD_EQUIPMENT_TELEMETRY | รับสัญญาณจากกล่องเครื่องจักร | imei, vcc_voltage | dc.equipment.engine_hours.v1 | TELEMETRY_RECORDED | MACHINE | LOCAL_WRITE |
| LOCK_EQUIPMENT | สั่งล็อกเครื่องจักร | equipment_id, action | dc.equipment.control_command.v1 | EQUIPMENT_LOCKED | OWNER, MACHINE | DEVICE_CONTROL |
| REFRESH_PROFILE | ขอรีเฟรชโปรไฟล์ LINE | line_user_id, reason | dc.profile.snapshot.v1 | PROFILE_REFRESH_REQUESTED | STAFF, OWNER | LOCAL_WRITE |
| REQUEST_SITE_AUTHORIZATION | ขออนุมัติสิทธิ์หน้างาน | requester_line_user_id, destination_site_id, status | dc.authorization.site_request.v1 | AUTHORIZATION_REQUESTED | CUSTOMER, STAFF | LOCAL_WRITE |
| AUTOFILL_DOCUMENT | เติมข้อมูลเอกสารจากข้อมูลเดิม | document_type, company_id, items | dc.document.issue_request.v1 | - | STAFF, OWNER | READ_ONLY |
| RESPOND_TO_MESSAGE | ตัดสินและส่งคำตอบในแชท | line_user_id, message_type, received_at | dc.chat.outbound_message.v1 | MESSAGE_ANSWERED | CUSTOMER, STAFF, OWNER | EXTERNAL_WRITE |

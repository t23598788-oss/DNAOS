# DNA OS — System & Integration Manual

## 1. System Architecture Overview

### Role Separation
- **Kob Chat** = Presentation / Gateway Layer (UI แชท, Rich Menu, Flex Message)
- **DNA OS** = Business & Transaction Engine (ประมวลผลคำสั่ง, คุมสต็อกบ่อทราย/ปูน, ออก Invoice, คุมลูกหนี้)

### Data Flow Pattern
Client Message → Kob Chat Gateway → DNA OS Webhook Endpoint → Business Logic Processor → Kob Chat REST API → Client Flex Message Response

## 2. Integration Specifications

### 2.1 LINE Messaging API & LINE OA
- **Config Requirement:** Channel ID, Channel Secret (ใช้ตรวจ HMAC-SHA256 Signature), Channel Access Token
- **Flow:** รับ Webhook Event จาก LINE → DNA OS พาร์ส Intent → ส่ง Card/Flex Response

### 2.2 KBank KGP / K API Payment Gateway
- **Config Requirement:** Merchant ID, Terminal ID, Secret Key / Public Key, Callback Webhook URL
- **Flow:** สร้าง PromptPay QR / Bill Payment → ลูกค้าสแกนจ่าย → KBank ยิง Callback Webhook มายืนยัน → DNA OS อัปเดตสถานะบิลและออก Slip Verification

### 2.3 Kob Chat Bot API (v1)
- **Config Requirement:** `KOBCHAT_BOT_TOKEN` (kobbot_...), Webhook Secret (`X-Kob-Signature`)
- **Endpoints:** `POST /messages`, `PUT /webhook`, `PUT /menu`, `PUT /commands`

## 3. Debugging & Diagnostics Manual

### Case 1: ข้อความแชทไม่เด้งเข้า DNA OS
- ตรวจสอบ Webhook Signature (401)
- ตรวจสอบ Webhook SSL/HTTPS
- ตรวจสอบ Server Logs ฝั่ง Ingestion Engine

### Case 2: KBank ชำระเงินสำเร็จแต่บิลไม่ตัดยอด
- ตรวจสอบ KBank Callback Webhook Logs
- ตรวจสอบ Slip Verification API Status
- ตรวจสอบ Transaction Reconciliation Job

### Case 3: UI แสดงสถานะผิดพลาด (False Positive)
- ตรวจสอบ Health Check Ping Response ว่ายิงเช็ก Endpoint จริง
- หรือเป็นเพียง Sandbox Mock Response

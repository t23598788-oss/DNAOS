# CENTRAL BUSINESS PROCESSING FLOW
**วันที่:** 2026-10-25 · **โหมด:** read-only · **HEAD:** `d7fbb05b`
**คำถามที่ต้องตอบ:** ทุก Provider เข้าเส้นประมวลผลกลาง "ลำดับเดียวกัน 12 ขั้น" จริงหรือไม่

> 🟢 PROVEN · 🟡 โค้ดจริง ยังไม่รันกับข้อมูลจริง · 🔴 MISSING/FAIL

---

## 01 OBJECTIVE

พิสูจน์ว่าลำดับ 12 ขั้นของระบบกลางมีอยู่จริงและใช้ร่วมกันทุกช่องทาง โดย AI ทำหน้าที่เพียงจำแนก intent/สกัดข้อมูล — ไม่อนุมัติราคา การขาย การรับเงิน หรือภาษี

**ผลรวม: 🔴 FAIL** — มี canonical engine ครบทุกด้านการเงิน/เอกสาร แต่ **ไม่มีชั้น "Business Intent" กลาง** และเส้น LINE ยังประมวลผลเองแบบขนาน (dual path) ทำให้ "ลำดับเดียวกันทุก provider" ยังไม่จริง

---

## 02 SOURCE EVIDENCE — 12 ขั้น mapped กับโค้ดจริง

| # | ขั้น | โมดูล/ตารางจริง | ชั้น | สถานะ |
|---|---|---|---|---|
| 1 | รับข้อความ/คำขอ | `line-webhook-v2/index.ts` (LINE) · `app/api/gateway/observe/meta/route.ts` (Meta) · `integration_gateway_events` | Transport | 🟢 มี (แต่ LINE มี 2 ทาง) |
| 2 | บันทึก Source Evidence + ตรวจซ้ำ | `line_events` (raw_json, `line_message_id` **ไม่มี unique**) · `integration_gateway_events` upsert by `event_id` · `business_events.event_code UNIQUE` | Transport | 🟡 กลาง dedup ได้ · ขาเข้า legacy ยังซ้ำได้ |
| 3 | แปลงเป็น Business Intent | ❌ ไม่มีโมดูลกลาง — มี `ocr-classify.ts`, `build-event-from-extraction.ts` (edge) + `cognitive/pipeline.ts` (Next) แยกกัน | — | 🔴 ไม่มีชั้นกลาง |
| 4 | ระบุวัสดุ/ปริมาณ/โซน/วันส่ง | `business_events` (material_text, quantity, destination, event_date) · `material_types` · `entity_registry` · `engines/material-resolver.ts` | Business data | 🟡 ข้อมูลอยู่ แต่สกัดที่ edge |
| 5 | ค้นทรัพยากร/ผู้ผลิตจากทะเบียนเดิม | `pit_profiles`, `pit_materials`, `engines/distance.ts#findNearestPit`, `engines/material-resolver.ts` | Central engines | 🟢 |
| 6 | ตรวจผู้รับงาน + สิทธิ์ที่มีจริง | `engines/connect/identity.ts` (verified trust) · `authority_grants` 🔴 ไม่มี · `pending_authorizations` (ข้อความอิสระ) | Authority | 🔴 อำนาจไม่มีโมเดล |
| 7 | สร้าง/อัปเดต Transaction ผ่าน authority เดิม | `engines/canonical/transaction-write.ts#createTransaction` + `changeTransactionStatus` · `app/api/admin/transactions/route.ts:85` · `engines/jobs/auto-create.ts:154` | Canonical | 🟡 มีจริง แต่ **ไม่ได้ถูกเรียกจาก provider path** (admin เป็นผู้เรียก) |
| 8 | ส่งคำขอไปผู้ผลิตผ่านช่องทางติดต่อ | `app/api/admin/pits/[pitId]/request-quote/route.ts` → `sendLineMessage` (`registry/communication.ts:37`) | Outbound | 🟡 ไม่ผูก transaction/ไม่มี message id |
| 9 | รับข้อความ/เอกสารตอบกลับ | `supplier-quote-reply.ts` (ข้อความ) · `process-classified-image.ts` (เอกสาร) · `connect-inbound` (receipt) | Provider tier | 🟡 ประมวลผลใน provider tier |
| 10 | ตรวจเอกสาร/ราคาที่ยืนยัน | `pit_price_requests` status `pending→answered` + `reply_price` · ไม่มีขั้น "verify" | — | 🔴 ไม่มีขั้นตรวจ/อนุมัติ |
| 11 | ประมวลผลสถานะ/เอกสาร/ค่าบริการ ผ่าน Canonical Engine | `canonical/document-write.ts` 🟢 · `canonical/payment-write.ts` 🟢 · `canonical/expense-write.ts` 🟢 · ค่าบริการ 🔴 ไม่มี | Canonical | 🟡 เอกสาร/เงิน ✔ · fee ✘ |
| 12 | ส่งผลกลับผู้ติดต่อผ่าน Response Gateway | `ResponseGateway` (`engines/response.ts:228–251`) · `pushLineFlex/replyText` | Response | 🟢 |

### 2.1 หลักฐานว่า "ลำดับเดียวกัน" ยังไม่จริง
- **Meta จบที่ขั้น 1–2**: observe route → adapter → bus → `integration_gateway_events` (ไม่มี intent/ธุรกรรม)
- **LINE วิ่งครบ 1–12 ในฟังก์ชันเดียว** (index.ts L90–113) *พร้อมกับ* forward ไป observe (L132)
→ Provider ใหม่ (Meta) ได้แค่ event กลาง แต่ยังไม่มีเส้นทางไปถึงธุรกรรม; Provider เก่า (LINE) มีเส้นทางของตัวเองที่ไม่ผ่าน intent กลาง

### 2.2 AI อยู่ตรงไหน (ตรวจแล้ว)
| การกระทำ | AI ทำได้ | หลักฐาน |
|---|---|---|
| จำแนกชนิดเอกสาร / สกัด field | ✅ (`ocr-classify`, local Ollama pipeline) | `ocr-classify.ts` |
| ตั้งชื่อ event / material text | ✅ (`build-event-from-extraction`) | |
| อนุมัติราคา/ขาย/รับเงิน/ภาษี | ❌ ไม่มีโค้ด AI เขียนสถานะการเงินโดยตรง | grep: money writes อยู่ที่ canonical เท่านั้น (test D) |
| เสนอราคาเป็นตัวเลข | 🟡 `extractPrice` อ่านตัวเลขจากข้อความแล้วเขียนราคา (ไม่ใช่ AI แต่เป็น parser) | `supplier-quote-reply.ts:12–18` |

---

## 03 RESULT

| เกณฑ์ | ผล |
|---|---|
| มีลำดับ 12 ขั้นครบและทุก provider ใช้เส้นเดียวกัน | 🔴 FAIL |
| AI ไม่เป็นผู้อนุมัติการเงิน/ภาษี | 🟢 PASS (การเงินอยู่ใน canonical เท่านั้น) |
| มีจุดเดียวที่แปลง intent | 🔴 FAIL (3 ที่: ocr-classify, build-event-from-extraction, cognitive/pipeline) |
| ผู้ผลิตถูกตรวจสิทธิ์ก่อนรับงาน | 🔴 BLOCKED (ไม่มี authority model) |
| ค่าบริการประมวลผลอยู่ในเส้นกลาง | 🔴 MISSING |

### 3.1 ช่องว่างที่ต้องปิด (เรียงตามลำดับพึ่งพา)
1. **Business Intent กลาง** — หนึ่ง contract (`IntentReceived`) ที่ทุก adapter แปลงเข้า; ปัจจุบัน capability `intent.received` มีในสัญญาแต่ไม่มี producer
2. **Canonical RFQ command** — ขั้น 8 ต้องเป็น command กลาง (`purchase_request.create`) ไม่ใช่ route เฉพาะ pit
3. **Seller response command** — ขั้น 9–10 ต้องมีที่เก็บคำตอบ + การตรวจ (ไม่ใช่เขียนราคาทันที)
4. **Transaction linkage** — ขั้น 7 ต้องถูกเรียกจาก event กลาง (ไม่ใช่ admin อย่างเดียว)
5. **Fee** — ขั้น 11 ส่วนค่าบริการ (ดู `PROCESSING_FEE_CONTRACT.md`)

> ทั้ง 5 ข้อเป็นการออกแบบ/ข้อเสนอ ยังไม่มีการแก้โค้ดในรอบนี้

# CANONICAL WRITER ENFORCEMENT PLAN
**วันที่:** 2026-10-25 · **สถานะ:** แผนเท่านั้น — **ไม่มีการแก้ source/DB/migration ในรอบนี้**
**อ้างอิง:** `PROVIDER_DIRECT_WRITE_MATRIX.md` (14 จุด) · `CONNECT_CHANNEL_BOUNDARY_AUDIT.md` (dual path, sender identity)

---

## 01 หลักการและข้อจำกัด

1. **ย้ายการเรียกกลับ ไม่สร้าง writer ใหม่** — ของเดิมที่มี authority อยู่แล้ว: `document-write`, `payment-write`, `expense-write`, `event-write`, `transaction-write`, `inbound-write`
2. **ราคาเป็นข้อยกเว้นเดียวที่ต้อง "รวม" ก่อน** — วันนี้ไม่มี canonical price writer: มี route (`materials/route.ts`) เขียนตรง + reply parser เขียนตรง = 2 writer โดยพฤตินัย → ต้อง **รวมเป็นคำสั่งเดียว** ไม่ใช่เพิ่มตัวที่สาม
3. ทุกคำสั่งใหม่ต้อง: fail-closed, มี `actor`, มี `evidence`, เขียน `recordCanonicalAudit`, และ idempotent
4. ห้ามแตะ migration ในรอบนี้ — ข้อที่ต้องมีตารางใหม่ให้ทำเป็น proposal
5. ทุกการย้ายต้องมี regression test ที่ **ล้มได้จริง** (ไม่ใช่แค่ผ่าน)

---

## 02 ลำดับงาน (5 waves) — เรียงตามความเสี่ยง

### WAVE 1 — ราคา (เสี่ยงสูงสุด, ทำก่อน)
| จุด | ปัจจุบัน | เป้าหมาย |
|---|---|---|
| `supplier-quote-reply.ts:68,70` | เขียน `pit_materials` ตรง | เรียก **คำสั่งกลางเดียว** `updateMaterialPrice()` |
| `supplier-quote-reply.ts:51` | update `pit_price_requests` ตรง | คำสั่งเดียวกันอัปเดต request + price + audit ในครั้งเดียว |
| `app/api/admin/pits/[pitId]/materials/route.ts:62–87` | เขียน price + audit แยก 2 คำสั่ง (ไม่ atomic) | เรียกคำสั่งเดียวกัน |
| `supplier-quote-reply.ts:12–18` (`extractPrice`) | ตัวเลขแรก = ราคา | คำสั่งกลางต้องรับ `source_message_text` + `request_id` และตั้งสถานะ `pending_review` จนกว่าจะยืนยัน |

**รูปแบบที่เสนอ (ต้องอนุมัติก่อน):**
- เพิ่ม internal route `POST /api/internal/connect/material-price` (secret header แบบเดียวกับ bridge อื่น) → เรียกฟังก์ชันกลาง
- ฟังก์ชันกลาง 1 ตัว (ที่เดียว) ทำ: ตรวจ request ยัง pending → ตรวจผู้ขายตรงกับ request → เขียน price + request status → `recordCanonicalAudit("price.updated"/"price.created")` → คืน `{ price_id, request_status, audit_id }`
- **ไม่สร้างตารางใหม่** — ใช้ `pit_materials` + `pit_price_requests` เดิม
- ต้องเพิ่ม `price.updated|price.created` ใน `CANONICAL_AUDIT_ACTIONS` (`engines/canonical/audit.ts`) และแก้ `recordCanonicalAudit` ให้เก็บ actor จริงก่อน (ดู WAVE 5)

**เหตุผลที่ต้องทำก่อน:** เป็นจุดเดียวที่ข้อความจากภายนอกเปลี่ยน "ราคาขายจริง" ได้โดยไม่มีหลักฐาน — ความเสี่ยงทางธุรกิจและภาษีสูงสุด

---

### WAVE 2 — อำนาจ (authority)
| จุด | ปัจจุบัน | เป้าหมาย |
|---|---|---|
| `authorization-check.ts:60` | insert `pending_authorizations` | หยุดเขียนจาก provider tier; สร้างผ่านคำสั่งกลาง `authority.request` (ผู้อ้าง + ผู้รับผิดชอบ + เหตุผล + transaction) |
| `handlers/postback.ts:100` | update approve/deny | คำสั่งกลาง `authority.decide` (ตรวจว่าผู้กดเป็นผู้รับผิดชอบจริง + บันทึก evidence message id) |
| `authorization-check.ts:37–44` | ผู้รับผิดชอบ = link เก่าสุด | เลือกจาก `authority_grants`/owner ที่ระบุชัด (ห้ามเดาจากลำดับ link) |

**หมายเหตุ:** เป้าหมายระยะยาวคือ `authority_grants` (TAX G2: scope + valid_from/to + วงเงิน + ไฟล์มอบหมาย) — `pending_authorizations` เดิมเก็บเป็นประวัติเท่านั้น

---

### WAVE 3 — การเงินของบริการพิมพ์ (`print_jobs`)
| จุด | ปัญหา | เป้าหมาย |
|---|---|---|
| `print-jobs.ts:100` | cash → `status=paid` ทันที | เปลี่ยนเป็น `collect_on_pickup` (ยังไม่ใช่รายได้) — **ต้องให้เจ้าของยืนยันนโยบาย** เพราะเดิมสั่งไว้ว่า "เงินสดดำเนินการเลย" |
| `print-jobs.ts:147` | `paid` + `amount_paid` จากข้อความ | ต้องมีหลักฐานชำระ (สลิป → `receipt_documents` → `confirmPayment`) |
| `print-jobs.ts:42,74` | คำนวณ `amount_expected` ใน provider tier | คำนวณด้วย pricing engine กลาง; เก็บเป็น "ราคาที่เสนอ" |
| `print-jobs.ts:111` | `payment_method` | เก็บเป็น preference ฝั่ง transport ได้ แต่ห้ามสื่อว่าจ่ายแล้ว |

**เกณฑ์ผ่าน:** ไม่มีแถว `print_jobs.status='paid'` ที่ไม่มีหลักฐานหรือการยืนยันของเจ้าของบันทึกไว้

---

### WAVE 4 — ข้อมูลหลัก (`customer_sites`) + บิล SaaS
| จุด | ปัญหา | เป้าหมาย |
|---|---|---|
| `event-followup.ts:527,542` · `handlers/location.ts:62` | สร้างไซต์จากข้อความ/พิกัด โดยไม่ตรวจสิทธิ์ | คำสั่งกลาง `site.create` (ตรวจบริษัท + ผู้มีอำนาจ + กันซ้ำด้วยพิกัด/ชื่อ) |
| `owner-dispatcher.ts:154` | เขียน `supabase_billing_events.status='paid'` | เปลี่ยนเป็น read model ที่ derive จาก payable/expense ที่ย้ายผ่าน bridge แล้ว |

---

### WAVE 5 — หลักฐานและด่านกันถอยหลัง
| งาน | รายละเอียด |
|---|---|
| audit actor จริง | `recordCanonicalAudit` ต้องเก็บ `actor_user_id`/`ip`/`user_agent` (ตอนนี้ `null`) + `evidence` แยก field |
| census gate | ใช้ `scripts/central-processing-boundary.test.ts --strict` เป็นด่าน: ต้องเหลือ 0 direct write ก่อน merge wave ถัดไป |
| retire legacy | หลังย้ายครบ: ลบ handler ที่ไม่ถูกเรียก (ต้องมี zero-caller proof) แล้วให้ test B บังคับถาวร |
| provider evidence | เพิ่ม `sender_id` ใน LINE adapter evidence (หรืออ้าง `line_events.id` — เลือกหนึ่ง) |

---

## 03 Regression test ที่ต้องมีต่อการย้ายแต่ละจุด

| Wave | Test (ใหม่/เดิม) | ต้องพิสูจน์ |
|---|---|---|
| 1 | `price-write-authority.test.ts` (ใหม่) | ① เขียนราคาจากคำตอบผู้ขาย → มี audit 1 แถว + request เปลี่ยนสถานะพร้อมกัน ② retry ข้อความเดิม → ไม่เขียนซ้ำ ③ request ไม่ pending → ปฏิเสธ ④ ไม่มี LINE link → ปฏิเสธ |
| 1 | `document-authority-census.test.ts` (เดิม) | ยังไม่มี `.from("pit_materials")` นอกคำสั่งกลาง |
| 2 | `authority-claim.test.ts` (ใหม่) | ① ผู้อ้างที่ไม่ใช่เจ้าของสร้าง claim ไม่ได้ถ้าไม่มี transaction ② postback จากเบอร์ที่ไม่ใช่ผู้รับผิดชอบ → ปฏิเสธ ③ ทุกการอนุมัติมี evidence message id |
| 3 | `print-job-payment.test.ts` (ใหม่) | ① ข้อความ "จ่ายสด" ไม่ทำให้ status=paid ② สลิปจริง → paid ผ่าน confirmPayment ③ ยอดคงเหลือถูกต้อง |
| 4 | `site-create-authority.test.ts` (ใหม่) | ① สร้างไซต์ให้บริษัทที่ไม่ได้ผูก → ปฏิเสธ ② สร้างซ้ำพิกัดเดิม → ไม่สร้างซ้ำ |
| 5 | `central-processing-boundary.test.ts` (ไฟล์รอบนี้) | `--strict` ต้อง exit 0 → บังคับว่าไม่มี direct write เหลือ |
| ทุก wave | `tsc --noEmit` | 0 error (รอบนี้: 0) |

---

## 04 เกณฑ์ปิดแต่ละ wave (Definition of Done)

1. direct write ของหมวดนั้น = 0 (test B)
2. audit row มี actor/evidence ครบสำหรับทุกการเขียนใหม่
3. test ใหม่ผ่าน + test เดิมไม่ถอย (document-authority 58, business-event 34, connect-* 68, payment-atomic)
4. ไม่มี migration ที่ยังไม่ได้รับอนุมัติถูก apply
5. มีหลักฐาน "ก่อน/หลัง" (test output) แนบใน PR description

---

## 05 ความเสี่ยงของการแก้ และวิธีลด

| ความเสี่ยง | ผลกระทบ | ลดอย่างไร |
|---|---|---|
| ตัด legacy handler แล้วมี intent ตกหล่น | ผู้ใช้ไม่ได้รับคำตอบ | ทำทีละ handler + parity test (same input → same reply/behavior) ก่อนลบ |
| ราคากลายเป็น pending ทำให้ผู้ขายรอ | งานช้าลง | ตั้ง SLA + แจ้งเจ้าของ (และผู้ขายยังได้รับข้อความยืนยันว่ารับเรื่องแล้ว) |
| เปลี่ยน print cash → collect_on_pickup | กระทบกระบวนการหน้าร้าน | ต้องอนุมัติเจ้าของก่อน (นโยบายเดิม 2026-07-25) |
| authority model ใหม่ชนกับของเดิม | ผู้ใช้ถูกปฏิเสธเกินจำเป็น | ช่วงเปลี่ยนผ่าน: อ่าน `authority_grants` ก่อน ไม่มี → ใช้ behavior เดิม **แต่บันทึก audit ว่าเป็น legacy path** |
| เพิ่ม internal route ใหม่ | พื้นผิวโจมตีเพิ่ม | secret header + allow-list command + fail-closed 503 (แบบเดียวกับ bridge เดิม) |

---

## 06 สิ่งที่ **ห้าม** ทำในแผนนี้

- ห้ามสร้าง `lineWriter` / `messengerWriter` / provider fee engine
- ห้ามสร้างเอกสาร engine แยกตามช่องทาง
- ห้ามให้ AI อนุมัติราคา/การขาย/การรับเงิน
- ห้ามใช้ `company_line_links` ลำดับแรกเป็นผู้มีอำนาจ
- ห้ามแก้ production data เพื่อ "ล้าง" 14 จุดนี้

---

## 07 คำถามที่ต้องให้เจ้าของตัดสิน

1. ราคาจากคำตอบผู้ขาย: ให้มีผลทันที หรือต้องมีคนยืนยันก่อน (แนะนำ: ยืนยันก่อน)
2. `print_jobs` เงินสด: คงพฤติกรรมเดิม (paid ทันที) หรือเปลี่ยนเป็น "รับเงินปลายทาง"
3. ผู้รับผิดชอบของบริษัท: ใช้ owner ใน `authority_grants` เท่านั้น หรือยังอนุญาต first-link เป็นกรณีฉุกเฉิน
4. จะ retire legacy LINE pipeline เมื่อใด (ต้องมี parity test ครบทุก intent)
5. เพิ่ม `sender_id` ใน LINE evidence หรืออ้าง `line_events.id` เป็นตัวชี้ sender

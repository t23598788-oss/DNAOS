# CENTRAL PROCESSING REGRESSION TEST
**วันที่:** 2026-10-25 · **HEAD:** `d7fbb05b` · **ประเภท:** Static + Mock (offline) — ไม่มี DB, ไม่มี network, ไม่มีข้อความจริง
**ไฟล์ทดสอบใหม่:** `scripts/central-processing-boundary.test.ts` (local, ยังไม่ commit)

---

## 01 OBJECTIVE

พิสูจน์เชิงกลไก (ไม่ใช่เชิงบรรยาย) ว่า:
1. adapter เป็น transport-only
2. provider tier ไม่เขียนธุรกิจ (หรือระบุจุดที่ยังเขียน)
3. LINE/Meta ให้ event กลางรูปร่างเดียวกัน + dedup ได้
4. canonical writer ไม่ผูกกับ provider
5. ข้อมูลสาธารณะผ่าน publication gate
6. actor มีขอบเขตองค์กร

---

## 02 วิธีรัน

```bash
npx tsx scripts/central-processing-boundary.test.ts            # รายงานผล (exit 0)
npx tsx scripts/central-processing-boundary.test.ts --strict   # ใช้เป็น gate (exit 1 เมื่อมี finding)
```

---

## 03 สิ่งที่ทดสอบ (A–F) และผลจริง

| ชุด | ตรวจอะไร | วิธี | ผล | จำนวน |
|---|---|---|---|---|
| **A** | adapter/observe route ไม่เขียน business table และไม่เรียก canonical writer | static scan ทุกไฟล์ใน `engines/integration-gateway/adapters` + `app/api/gateway/observe` | 🟢 **PASS ทุกไฟล์** | 22 |
| **B** | provider tier (legacy LINE) ไม่เขียน business table | static census: จับ `.from("<table>")` + write op ใน chain เดียวกัน (≤8 บรรทัด) | 🔴 **FAIL — 14 จุด** (ตาม `PROVIDER_DIRECT_WRITE_MATRIX.md`) | 7 (census 1 FAIL + bridge 6 PASS) |
| **B2** | bridge ต้องส่งเข้า central boundary เท่านั้น | static: มี `fetch` ต้องชี้ `/api/internal/connect/` หรือ `/api/gateway/observe/` | 🟢 PASS 5 · อ่านอย่างเดียว 1 | 6 |
| **C** | LINE และ Meta ให้ event กลางเหมือนกัน | mock payload จริง → `normalizeLineWebhook` / `normalizeMetaWebhook` | 🟢 capability/channel/contract/dedup ผ่าน · 🔴 LINE ไม่มี sender id | 7 |
| **D** | canonical writer ไม่ผูก provider | static: ห้าม import provider layer / branch `provider === "line"` / เรียก provider API | 🟢 **PASS 11/11 ไฟล์** | 11 |
| **E** | public reader ผ่าน publication gate | static: ต้องอ้าง `publication_records` + policy | 🟢 PASS | 2 |
| **F** | actor มี company scope | static: `requireAuth`/`session` ต้องมี scope | 🔴 **FAIL — มีแค่ role** | 1 |

### 3.1 ผลรวม
```
checks=50 failed=3
GATE: FAIL (3 findings)
--strict → exit code = 1  (ยืนยันแล้ว)
```
**3 findings:**
1. `B` — 14 direct business writes ใน provider tier
2. `C` — LINE evidence ทิ้ง `source.userId` (sender identity)
3. `F` — ไม่มี company scope บน actor

### 3.2 ตัวอย่าง output จริง (ตัดมา)
```
FAIL  B 14 direct business write(s) remain in the provider tier
        ↳ engines/authorization-check.ts:60 pending_authorizations.insert
        ↳ engines/supplier-quote-reply.ts:51 pit_price_requests.update
        ↳ engines/supplier-quote-reply.ts:68 pit_materials.update
        ↳ engines/supplier-quote-reply.ts:70 pit_materials.insert
        ↳ engines/print-jobs.ts:100 print_jobs.update
        … (อีก 9 จุด)
PASS  C both providers map to the same capability  ↳ message.received
PASS  C event_id is deterministic (same message ⇒ same id ⇒ idempotent upsert)
PASS  C providers cannot collide on event_id
PASS  C raw message text never enters evidence (privacy boundary holds)
FAIL  C LINE evidence drops SENDER IDENTITY
        ↳ evidence keys = webhook_event_id,event_type,source_type,message_type,has_media,is_redelivery,channel_destination,provider_timestamp
FAIL  F NO company scope on the authenticated actor
```

---

## 04 ชุดทดสอบเดิมที่รันซ้ำในรอบนี้ (ไม่ถอย)

| suite | ผล | จำนวน |
|---|---|---|
| `connect-boundary-census-test.ts` | PASS | 15 |
| `connect-inbound-boundary-test.ts` | PASS | 53 |
| `business-event-authority-test.ts` | PASS | 34 |
| `document-authority-census.test.ts` | PASS | 58 |
| `payment-atomic-boundary-test.ts` | PASS | 12+C1–C4 (สรุปตาม output ของชุด) |
| `npx tsc --noEmit` | **0 error** (exit 0) | — |

---

## 05 Coverage vs ข้อกำหนด STEP 06 (10 ข้อ)

| # | ข้อกำหนด | สถานะ | หลักฐาน |
|---|---|---|---|
| 1 | LINE/Messenger/เว็บ ส่ง intent เดียวกันเข้าศูนย์กลาง | 🟡 LINE+Meta ✔ · เว็บ **ไม่มีช่องทาง** | test C |
| 2 | ข้อความซ้ำไม่สร้าง transaction ซ้ำ | 🟡 event กลาง dedup ✔ · ขาเข้า legacy ไม่มี unique | test C + `line_events` schema |
| 3 | adapter ไม่เขียนราคา/บัญชี/เอกสาร | 🟢 PASS (adapters) · 🔴 provider tier 14 จุด | test A / B |
| 4 | ข้อความตอบกลับผูกกับ transaction เดิม | 🔴 ไม่มี linkage | `pit_price_requests` ไม่มี `transaction_id` |
| 5 | เปลี่ยนช่องทางไม่เปลี่ยนสูตร/ค่าบริการ | 🔴 ยังพิสูจน์ไม่ได้ (ไม่มี fee model) | `PROCESSING_FEE_CONTRACT.md` F-1 |
| 6 | Document Writer ไม่ขึ้นกับ provider | 🟢 PASS | test D (11/11) |
| 7 | Finance Writer ไม่ขึ้นกับ provider | 🟢 PASS | test D + payment-atomic |
| 8 | ผู้ผลิตไม่ตอบ ระบบไม่อนุมัติขายเอง | 🟢 PASS (ไม่มีเส้นทาง auto-approve) | ไม่มีโค้ดสร้างธุรกรรมจากข้อความตอบ |
| 9 | ข้อมูลข้ามองค์กรถูกปฏิเสธ | 🔴 FAIL | test F (ไม่มี scope) |
| 10 | ข้อมูลสาธารณะผ่าน Publication Policy | 🟢 PASS | test E + public-catalog-policy 112/112 |

---

## 06 ระดับหลักฐาน (แยกให้ชัดตามที่สั่ง)

| ประเภท | รายการ |
|---|---|
| **Static Test (รันจริงรอบนี้)** | A, B, D, E, F = 43 checks + 4 ชุดเดิม (160 checks) + payment-atomic (12+C1–C4) |
| **Mock Test (รันจริง รอบนี้)** | C (7 checks) — adapter normalization ด้วย payload จำลอง |
| **Live Evidence** | **ไม่มีในรอบนี้** — ไม่เชื่อม DB จริง/ไม่ดึง trace production; ตัวเลข production ที่อ้างในรายงานก่อนหน้า (companies 86, audit_logs 4,806 ฯลฯ) เป็นของรอบ audit ก่อน ไม่ใช่รอบนี้ |

---

## 07 ข้อจำกัดของชุดทดสอบนี้ (พูดตรง)

1. **Static census เป็น heuristic** — จับ `.from("table")` + write op ภายใน 8 บรรทัด ถ้ามีโค้ดเขียนผ่านตัวแปร dynamic (`db[tableName]`) จะไม่ถูกจับ (มี NC ใน `document-authority-census` ที่จัดการเคสนี้แล้ว — ควรพอร์ตมาเพิ่มในรอบถัดไป)
2. **Mock payload ไม่ใช่ payload จริงจากผู้ให้บริการ** — รูปร่างอ้างสัญญา LINE/Meta ตาม adapter ที่มีอยู่ ไม่ได้เก็บจาก production
3. **ไม่มี negative control สำหรับ "provider ใหม่"** — ยังไม่มี adapter ที่ 3 ให้ทดสอบ parity จริง
3.1 **WAVE 1: จำนวน direct write ไม่ลดลง (14→14)** — เพราะไม่มีจุดใดผ่านเกณฑ์ย้าย authority ในรอบนี้ (ดู `WAVE1_CENTRAL_AUTHORITY_CONSOLIDATION.md`)
4. **ไม่ทดสอบ HTTP layer** ของ observe route (ทำใน `connect-channel-receive.test.ts` 77 checks ซึ่งผ่านในรอบก่อน — รอบนี้ไม่ได้รันซ้ำ)

---

## 07.1 อัปเดต WAVE 1 (2026-10-25)

ไฟล์ทดสอบนี้ถูก **ขยาย** ในรอบ WAVE 1 (ทดสอบเท่านั้น ไม่แตะโค้ดธุรกิจ) — เพิ่มหมวด **G** สำหรับ STEP 4 cross-channel:

| check | ผล |
|---|---|
| G1 adapter ไม่สร้าง field ธุรกิจ (material/price/company) | PASS ทั้ง LINE/Meta |
| G2 adapter ไม่แตะ financial writer/table | PASS 11/11 ไฟล์ |
| G3 provider tier ไม่ออกเอกสาร | PASS |
| G4 ข้อความผู้ขายแก้ราคากลางโดยไม่ตรวจสิทธิ์ | **FAIL** |
| G5 transaction creation ไม่มี idempotency | **FAIL** |
| G6 Meta ไม่มี outbound path | **FAIL** (LINE ผ่าน) |
| G7 adapter ไม่จับคู่ identity จาก display name | PASS |

ผลรันล่าสุด: **checks=69 failed=6** (`B`, `C`, `F`, `G4`, `G5`, `G6`) · `--strict` exit 1 · `tsc --noEmit` 0 error

## 08 วิธีผูกเข้า CI (ข้อเสนอ)

1. เพิ่ม npm script: `"boundary:test": "tsx scripts/central-processing-boundary.test.ts"` และ `"boundary:gate": "... --strict"`
2. ใส่ `--strict` ใน `prebuild` **หลัง** ปิด B ให้เหลือ 0 (ไม่ใช่ก่อน — จะบล็อก build ทันที)
3. ระหว่างเปลี่ยนผ่าน: รันแบบไม่ strict ใน CI และรายงานจำนวน finding เป็น metric (ต้องลดลงทุก wave ตาม enforcement plan)
4. **ห้ามเปิด strict ตอนนี้** — direct writes ยัง 14 และ findings 6 จะบล็อกทุก build

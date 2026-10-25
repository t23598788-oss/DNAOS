# B2B TRANSACTION LIFECYCLE
**วันที่:** 2026-10-25 · **โหมด:** read-only (ตรวจโค้ด + รันชุดทดสอบ offline) · ไม่มี migration/commit/deploy/ข้อความจริง
**กรณีทดสอบ:** เฮียอุทัย (ผู้ขายรายแรก) · **HEAD:** `d7fbb05b`

> **ชั้นหลักฐาน**
> 🟢 **PROVEN** = อ่านจาก Production/ไฟล์จริงในรอบก่อนหรือรอบนี้ (มี ID/บรรทัดกำกับ)
> 🟡 **โค้ดจริง** = ตรวจ source แล้ว ยังไม่รันกับข้อมูลจริงในรอบนี้
> 🔴 **MISSING** = ไม่มีอยู่จริงในระบบ
> 🔵 **PROPOSED** = ข้อเสนอ ยังไม่ทำ (ต้องอนุมัติ)

---

## 01 OBJECTIVE

กำหนด **ลำดับเหตุการณ์ธุรกรรมเดียว** ตั้งแต่ผู้ซื้อสนใจวัสดุจนปิดงาน โดยใช้ของเดิมทั้งหมด และพิสูจน์ว่าธุรกรรมหนึ่ง ๆ เดินได้ถึงขั้นไหนจริง/ติดอะไร

**เกณฑ์ผ่าน**
1. ทุกขั้นอ้าง Source Record จริงได้ (ไม่ใช่สถานะที่ AI แต่ง)
2. Transaction ID เดียว join เอกสาร + เหตุการณ์ + ข้อความได้
3. ผู้ขาย = เฮียอุทัย, DNA OS = ผู้ให้บริการประมวลผล (ไม่ใช่ผู้ขาย ไม่ใช่เจ้าของรายได้ค่าวัสดุ)
4. การส่งข้อความ ≠ การยืนยันขาย
5. ไม่มีขั้นใดต้องใช้ writer คู่ขนานใหม่

**ผลรวม: 🔴 BLOCKED** — เดินได้ถึงขั้น 9 (คำสั่งซื้อ) ในเชิงโครงสร้าง แต่ขั้น 8 (ใบเสนอราคาในนามผู้ขาย) ติด gate เอกสาร/ภาษี และขั้น 11 (แยกค่าบริการ) ไม่มีโมเดลเลย

---

## 02 SOURCE EVIDENCE — ของจริงที่มีอยู่

### 2.1 ตัวตนและคู่สัญญา
| รายการ | ค่าจริง | ที่มา |
|---|---|---|
| กิจการเฮียอุทัย | `companies baf76c98-5e50-4a5f-b6f1-5527e2daa710` "เฮียอุทัย สานุสันต์" · type `CUSTOMER` · ACTIVE | 🟢 B2B_MANAGED_SERVICE_ARCHITECTURE §2.3 |
| ช่องทาง LINE | `company_line_links` ↔ `Uc49b5932f69629aea670883d5cd07662` · `connect_external_identities` provider `line`, trust `verified` | 🟢 เดียวกัน |
| บัญชี login | 🔴 ไม่มี (`identities` ไม่มีแถวผูก) | 🟢 เดียวกัน |
| บ่อที่ผูกกับเขา | 🔴 ไม่พบใน `pit_profiles` | 🟢 เดียวกัน |
| ตัวตน DNA OS | 🔴 ไม่มีแถว `companies` ที่ระบุเป็นผู้ออกเอกสาร (CompanyType.CORE ไม่ถูกใช้ในโค้ด) | 🟡 grep ทั้งโปรเจกต์ |

### 2.2 ชิ้นส่วนที่ใช้เดิน lifecycle ได้จริง
| ขั้น | ของจริง | ไฟล์/ข้อมูล | สถานะ |
|---|---|---|---|
| เลือกวัสดุ/โซนบนเว็บ | public catalog reader (default-deny 4 ชั้น, TTL 60s) | `services/public-catalog/reader.ts:69,86` | 🟡 โค้ดจริง |
| รับคำขอซื้อ | `business_events` (event_code, `source_message_ids uuid[]`, `transaction_id uuid`, quantity/material/destination) | `supabase/local-migration/full_schema.sql` (business_events) | 🟡 |
| ข้อความเข้า | `line_events` (line_user_id, raw_text, `line_message_id`, extracted, status) | `20260709000002_line_events.sql:6–21` | 🟡 |
| ราคา/บริการ | `pit_materials`, `publication_records` (owner gate + allowed fields) | audit รอบก่อน P2 | 🟡 |
| ยืนยันผู้ขาย | `resolveExternalIdentity` / `resolveProviderSubjectsForCompany` | `engines/connect/identity.ts:69,126` | 🟡 |
| ส่งคำขอถึงผู้ขาย LINE | `POST /api/admin/pits/[pitId]/request-quote` → `sendLineMessage` | route + `registry/communication.ts:37` | 🟡 |
| รับคำตอบผู้ขาย | `trySupplierQuoteReply` (จับตัวเลข → ราคา) | `supabase/functions/line-webhook-v2/engines/supplier-quote-reply.ts` | 🟡 |
| ใบเสนอราคา | `createDocument` (canonical writer + atomic RPC + version) | `engines/canonical/document-write.ts:createDocument` | 🟡 |
| คำสั่งซื้อ + สถานะ | `customer_orders` + sale workflow (DRAFT→…→PAID) | `engines/transactions/workflows.ts:64–100` | 🟡 |
| เปลี่ยนสถานะ | `changeTransactionStatus` (canonical) | `engines/canonical/transaction-write.ts` · route `transactions/[id]/advance` | 🟡 |
| เงินเข้า | `receipt_documents` + `confirmPayment` (anchors, VOID guard, 1 สลิป = 1 การจัดสรร) | `engines/canonical/payment-write.ts:236–260` | 🟡 |
| Audit | `recordCanonicalAudit` | `engines/canonical/audit.ts` | 🟡 |

### 2.3 จุดที่โซ่เหตุการณ์ยังขาด
| # | ขาดอะไร | หลักฐาน |
|---|---|---|
| L1 | **ไม่มี Transaction ID บนเส้นทางขอราคา/ส่งข้อความผู้ขาย** | `pit_price_requests` ไม่มี `transaction_id` (full_schema), `line_outbound_drafts` ไม่มี `transaction_id` (`20260710000006:14–26`) |
| L2 | **ส่งข้อความก่อนสร้างแถวคำขอ** — คำตอบที่มาถึงก่อน insert จะหลุดการจับคู่ | `request-quote/route.ts`: `sendLineMessage` อยู่ก่อน `.insert(pit_price_requests)` |
| L3 | **ไม่มี message id ขาออก** — ผู้ให้บริการคืน `{}` | `registry/communication.ts:82` (คอมเมนต์ระบุเอง) |
| L4 | **ผู้ขาย "ตอบรับ" แสดงเป็นราคาเท่านั้น** — ไม่มีที่เก็บ "ยอมรับ/ไม่ยอมรับ/เงื่อนไข" ต่อธุรกรรม | `supplier-quote-reply.ts` (status pending→answered + `reply_price`) |
| L5 | **เส้นทางตอบกลับเขียน `pit_materials` ตรง** ไม่ผ่าน canonical writer และไม่เขียน audit | `supplier-quote-reply.ts` (supabase.update/insert) |
| L6 | **ไม่มี "ผู้ออกเอกสาร"** ในเอกสาร/คำสั่งซื้อ | `invoices`/`standalone_documents` ไม่มี issuer (TAX audit F1); `customer_orders` มีแต่ `customer_company_id` |
| L7 | **ไม่มีค่าบริการ DNA OS** | grep ทั้งโปรเจกต์ไม่พบ processing/platform fee; `service_fee_amount` มีเฉพาะ `credit_agreements` (สินเชื่อภายใน ไม่ใช่ค่าบริการ B2B) |
| L8 | **sale workflow จบที่ PAID ไม่มีสถานะ closed** | `workflows.ts` sale steps ลงท้าย `PAID` |
| L9 | **ไม่มีด่านบังคับเอกสารก่อนปิดงาน** (`expected_docs` เป็น metadata ไม่ถูกบังคับ) | `workflows.ts:100–105` (expected_docs) vs `advance` route (ไม่ตรวจ) |
| L10 | **ผู้ส่งคำขอต้องเป็น ADMIN_TIER เสมอ** — ไม่มีเส้นทางของผู้ซื้อ/ผู้ขายเอง | `request-quote/route.ts:19` `requireAuth(ADMIN_TIER)` |

---

## 03 LIFECYCLE ที่ระบบรองรับจริง (12 ขั้นตามคำสั่ง)

| # | ขั้น | สถานะ | ของจริงที่ใช้ | ต้องเพิ่ม/ตัดสินใจ |
|---|---|---|---|---|
| 1 | ผู้สนใจเลือกวัสดุ+โซนบนเว็บ | ✅ พร้อม | public reader (verified publication เท่านั้น) | — |
| 2 | DNA OS รับข้อความ/คำขอซื้อ | ✅ พร้อม | `line_events` + `business_events` | ผูก `transaction_id` ตั้งแต่ต้น |
| 3 | บันทึกผู้ติดต่อ/วัสดุ/ปริมาณ/โซน/ปลายทาง | ✅ พร้อม | `business_events` fields ครบ | — |
| 4 | ตรวจราคา/สถานะบริการจาก DB เดิม | ✅ พร้อม | `pit_materials` + publication status | ห้าม AI เติมราคา (มี policy แล้ว) |
| 5 | ตรวจผู้ขาย+สิทธิ์ที่มีหลักฐาน | ⚠️ ครึ่ง | identity verified ✔ · authority grant 🔴 | grant (TAX G2) + ผูก seller→company |
| 6 | ส่งคำขอไป LINE ผู้ขายผ่าน Connect เดิม | ⚠️ ส่งได้ แต่ไม่ผูกธุรกรรม | `request-quote` + `sendLineMessage` | `transaction_id` + message record + สร้างแถวก่อนส่ง (L1/L2/L3) |
| 7 | รับคำตอบ: ความพร้อม/ราคา/เงื่อนไข | 🔴 ไม่พอ | ตัวเลข→ราคา เท่านั้น | โมเดล "seller response" ต่อธุรกรรม (L4) |
| 8 | สร้างใบเสนอราคาในนามผู้ขาย | 🔴 BLOCKED | `createDocument` พร้อม แต่ไม่มี issuer/ผู้ขาย | `issuer_company_id` + snapshot parties (TAX P1) |
| 9 | ผู้ซื้อยอมรับ → คำสั่งซื้อ + เอกสารถัดไป | ✅ พร้อมเชิงโครงสร้าง | `customer_orders` (ต้องมี company→site→project→group) + `resolveOrderForDocument` | ต้องมี site/project จริงก่อน (fail-closed อยู่แล้ว) |
| 10 | บันทึกส่งมอบ + หลักฐานชำระจริง | ⚠️ ครึ่ง | status DELIVERED; `receipt_documents` + `confirmPayment` | ไม่มีด่านบังคับ DO ก่อน DELIVERED (L9); ต้องมีผู้รับเงินจริงต่อกิจการ (TAX F7) |
| 11 | แยกเงินค่าวัสดุของผู้ขาย vs ค่าบริการ DNA OS | 🔴 MISSING | — | `PROCESSING_FEE_CONTRACT.md` |
| 12 | ปิดธุรกรรม + Evidence Chain | 🔴 ไม่ครบ | audit row + versions | ไม่มีสถานะ closed (L8) + audit ไม่มี actor/trace (TAX F14) |

**สรุปเส้นทาง:** 1–4 เดินได้จริง · 5–7 ต้องเติม linkage · 8 หยุดที่ gate เอกสาร/ภาษี · 11 ไม่มีโมเดล · 12 ปิดไม่ได้อย่างมีความหมาย

---

## 04 Transaction ID เดียว — join ได้แค่ไหน

| ปลายทาง | คอลัมน์เชื่อม | join ได้? |
|---|---|---|
| เอกสาร (invoice/standalone) | `customer_order_id` | ✅ |
| business event | `business_events.transaction_id` | ✅ |
| payment | `payment_allocations.invoice_id/standalone_document_id/debt_event_id` | ✅ ผ่านเอกสาร |
| LINE message ขาเข้า | `business_events.source_message_ids uuid[]` | ✅ (ถ้าถูกบันทึกตอนสร้าง event) |
| LINE message ขาออก (ขอราคา/แจ้งผู้ขาย) | — | 🔴 ไม่มี |
| คำขอราคาผู้ขาย | — | 🔴 ไม่มี |
| ค่าบริการ DNA OS | — | 🔴 ไม่มี |

→ **ข้อกำหนด STEP 02 ("Transaction ID เดียวเชื่อมเอกสาร เหตุการณ์ และข้อความ") วันนี้ทำได้แค่ฝั่งขาเข้า + เอกสาร**

---

## 05 กฎที่ต้องบังคับ (ยืนยันจากโค้ดเดิม + ที่ยังไม่มี)

| กฎ | สถานะจริง |
|---|---|
| ห้าม AI สร้างราคาเมื่อไม่มีข้อมูล | ✅ มี (`public-catalog` policy + quote parser ต้องมี pending request จริง) |
| ครบลูกโซ่ก่อนสร้างเอกสาร | ✅ `resolveOrderForDocument` คืน error ไม่สร้าง half chain |
| ส่งข้อความสำเร็จ ≠ ผู้ขายอนุมัติ | ✅ **ไม่มีที่ให้สถานะนี้อยู่แล้ว** (จึงไม่มีการเทียบผิด) แต่ก็ยังไม่มีที่รับอนุมัติจริง (L4) |
| ผู้ขายต้องเป็นผู้ออกเอกสาร ไม่ใช่ DNA OS | 🔴 ขัดกับ F1/F3 (template fallback "DNA OS") |
| เงินค่าวัสดุไม่เข้ารายได้ DNA OS | 🔴 ยังแยกไม่ได้ (ไม่มี issuer/ไม่มี fee model) |
| ทุกการเขียนมี audit | ⚠️ canonical ✔ · price/rfq ✘ |

---

## 06 แผนทดสอบ lifecycle (mock เท่านั้น — ยังไม่รันจริง)

| # | กรณี | ต้องได้ | สถานะรันได้วันนี้ |
|---|---|---|---|
| T1 | รับคำขอซ้ำ (event เดิม) | ไม่สร้างธุรกรรมซ้ำ | ⚠️ `business_events.event_code` unique กันซ้ำระดับข้อความได้ แต่ยังไม่มี idempotency ต่อการสร้างธุรกรรม/คำขอผู้ขาย |
| T2 | ส่ง LINE ล้มเหลว | ไม่เปลี่ยนเป็น Seller Accepted | 🟡 ทดสอบได้ด้วย mock (ยังไม่มีสถานะนั้น) |
| T3 | ผู้ขายไม่ตอบ | ไม่ออกเอกสารขาย | 🟡 ได้ (ไม่มีเส้นทางออกเอกสารอัตโนมัติ) |
| T4 | ไม่มีสิทธิ์ผู้ขาย | fail-closed | 🔴 ไม่มี authority grant ให้ทดสอบ |
| T5 | เอกสารไม่แสดง DNA OS เป็นผู้ขาย | ผ่าน | 🔴 ไม่ผ่าน (fallback ยังอยู่) |
| T6 | ค่าวัสดุไม่เข้า revenue DNA OS | ผ่าน | 🔴 ไม่มีที่แยก |
| T7 | ค่าบริการคำนวณครั้งเดียว | ผ่าน | 🔴 ไม่มี fee model |
| T8 | audit ล้ม → ไม่มีการเขียนบางส่วน | ผ่าน | ⚠️ canonical throw ✔ · price path ไม่ |
| T9 | ภาษีไม่ครบ → Pending Review | ผ่าน | 🔴 ไม่มีสถานะ pending |
| T10 | เงินเข้าแต่ละฝ่ายตรวจแยก | ผ่าน | ⚠️ receipt/allocations มี แต่ไม่มี issuer |
| T11 | ไม่มีข้อมูลข้าม tenant | ผ่าน | 🔴 ไม่มี company scope |
| T12 | ทุก event ย้อนกลับ source ได้ | ผ่าน | ⚠️ ขาเข้า ✔ ขาออก ✘ |

---

## 07 สิ่งที่ต้องตัดสินใจก่อนเดินต่อ (blocking)

1. **ผู้ขายในระบบคือ `companies` แถวเดียวกับลูกค้า หรือต้องมีบทบาท seller แยก** (ตอนนี้เฮียอุทัยเป็น `CUSTOMER` แต่ทำหน้าที่ผู้ขาย)
2. **ผู้ซื้อที่สั่งจริงจะเข้ามาทางไหน** — LINE / เว็บ / พนักงานกรอก (ส่งผลต่อ identity + consent)
3. **"ผู้ขายตอบรับ" ต้องมีรูปแบบใด** — ข้อความอิสระ, ตัวเลขราคา, หรือข้อตกลงที่มีขอบเขต (แนะนำ: ต้องอ้าง `pit_price_requests`/transaction + มีหลักฐานข้อความ)
4. **ใครกดส่งคำขอถึงผู้ขาย** — admin เท่านั้น (ปัจจุบัน) หรือระบบอัตโนมัติหลังยืนยันข้อมูลครบ
5. **ปิดธุรกรรมนิยามว่าอะไร** — เงินครบ + เอกสารครบ + ค่าบริการชำระแล้ว (ต้องเพิ่มสถานะ closed)

> ยังไม่มีการแก้โค้ดหรือสร้างตารางใด ๆ ในรอบนี้ — ข้อ 2.3/05/06 เป็นข้อค้นพบ + แผน ไม่ใช่ของที่ทำแล้ว

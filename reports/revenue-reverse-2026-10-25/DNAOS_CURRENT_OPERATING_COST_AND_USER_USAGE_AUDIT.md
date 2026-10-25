# DNA OS — CURRENT OPERATING COST & USER USAGE AUDIT
**วันที่ตรวจ:** 2026-10-25 (snapshot `2026-10-24T22:06Z` → `2026-10-25T05:xxZ`)
**โครงการ Production:** `xeytcavxejhyzxwevgto` (DNA OS system, Northeast Asia / Seoul)
**โครงการ Staging:** `zjhgysugbmyyciatmltv` (dna-os-staging, Singapore)
**โหมด:** READ-ONLY ทั้งหมด — ไม่มีการแก้ Source Code, Database, สิทธิ์, ไม่มี Deploy/Commit/Push
**จุดตั้งต้น:** WAVE 4 Revenue Reverse Engineering + Production Census 2026-10-25 (ตรวจซ้ำทุกตัวเลขกับ Runtime ปัจจุบัน ไม่ใช้ตัวเลขรายงานเก่าโดยไม่ยืนยัน)

---

## 01 OBJECTIVE

แยกผลออกเป็น 2 งานเท่านั้น:

| # | งาน | คำถามที่ต้องตอบให้ได้ |
|---|---|---|
| 1 | ทรัพยากรคอมพิวเตอร์และต้นทุนดำเนินงานจริง | DNA OS ใช้อะไรประมวลผล อยู่ที่ไหน เปิดตลอดหรือตามคำขอ และจ่ายจริงเท่าไร แยกจากต้นทุนพัฒนา |
| 2 | บัญชีผู้ใช้ 3 บัญชีใน Production | แต่ละบัญชีมีสิทธิ์อะไร เข้าถึงอะไร เคยทำอะไร และก่อต้นทุนที่ตรวจสอบได้เท่าไร |

**ข้อห้ามที่ถือปฏิบัติ:** ไม่แก้ระบบ · ไม่เปิดเผย credential/PII · ไม่สมมติตัวเลข · ไม่รวมต้นทุนพัฒนาเข้ากับต้นทุนให้บริการ · ไม่ใช้ benchmark แทนการใช้งานจริง · ไม่ใช้จำนวนไฟล์/API/ตารางแทนปริมาณประมวลผล

---

## 02 SOURCE EVIDENCE

### 2.1 เครื่องมือตรวจ (สร้างใหม่ รอบนี้ — อ่านอย่างเดียว)

| ไฟล์ | ทำอะไร | หลักประกัน |
|---|---|---|
| `scripts/revenue-production-readonly-census.mjs` | นับ/รวมทุกตาราง Production (aggregates) | HTTP GET/HEAD เท่านั้น |
| `scripts/operating-cost-readonly-probe.mjs` | OpenAPI schema จริงของ Production, บัญชี auth (masked), attribution probe, bucket list | GET/HEAD เท่านั้น |
| `scripts/account-cost-attribution-readonly-probe.mjs` | org membership, ผู้สร้างเอกสาร, audit coverage, invoice dedupe, worker telemetry completeness, storage path shape | GET/HEAD เท่านั้น |

**ผลลัพธ์ดิบ (อ้างอิงได้):**
`reports/revenue-reverse-2026-10-25/production-census-2026-10-25.json`
`reports/revenue-reverse-2026-10-25/operating-cost-probe-2026-10-25.json`
`reports/revenue-reverse-2026-10-25/account-cost-attribution-2026-10-25.json`

**การปกป้องข้อมูล:** service-role key อ่านจาก Supabase CLI ในหน่วยความจำ ไม่พิมพ์/ไม่บันทึก · ไม่มีอีเมล ชื่อ เบอร์ LINE id ชื่อบริษัท หรือเนื้อหาเอกสารใน output · บัญชีแสดงเป็น hash 8 ตัว (`acct_xxxxxxxx`)

### 2.2 คำสั่งที่ใช้ยืนยัน Runtime (ไม่ใช่การอ่านรายงานเก่า)

| คำสั่ง | ผล |
|---|---|
| `npx supabase projects list` | 2 โครงการ: Production (Seoul, สร้าง 2026-05-22) + staging (Singapore, 2026-05-16) |
| `npx supabase functions list --project-ref xeytcavxejhyzxwevgto` | **21 functions ACTIVE** (line-webhook-v2 v146 อัปเดต 2026-10-11 ฯลฯ) |
| `npx supabase functions list --project-ref zjhgysugbmyyciatmltv` | **0 functions** |
| `npx supabase migration list --project-ref xeytcavxejhyzxwevgto` | **drift**: migration ฝั่ง local หลายตัวไม่ถูก apply และ Production มี 6 migration ที่ไม่มีในเครื่อง |
| `curl -I https://dna-os-deadboard.vercel.app/` | **HTTP 402 · `x-vercel-error: DEPLOYMENT_DISABLED`** · `server: Vercel` · `x-vercel-id: sin1::…` |
| `dig dnaos.co.th` / `curl https://dnaos.co.th/` | **ไม่ resolve (status 000)** — ยังไม่ผูกโดเมน |
| anon key HEAD 12 ตาราง (`companies`, `profiles`, `invoices`, `receipt_documents`, `document_canonical`, `line_events`, `ai_tasks`, `audit_logs`, `storage_resources`, `pit_profiles`, `subscription_services`, `company_expenses`) | **200 + `content-range: */0` ทุกตาราง** → RLS ปิดกั้น anonymous จริง |

### 2.3 ตารางอ้างอิง Source Code ที่ใช้ในรายงานนี้

`engines/canonical/audit.ts:78` · `core/auth/session.ts:30` · `core/auth/requireAuth.ts:24` · `core/auth/requireAuthPage.ts:16` · `middleware.ts:17,29,105` · `registry/permissions.json:38,43,56,84,253` · `app/api/v1/query/route.ts:80` · `services/supabase/api-tokens.ts:47` · `app/api/admin/ide/_lib/usageMeterRuntime.ts:68` · `supabase/functions/_shared/connect-price.ts:40` · `app/user/layout.tsx:16` · `app/user/page.tsx:26`

---

## 03 RESULT — สรุปผลรวม

| หัวข้อ | ผล | หลักฐาน |
|---|---|---|
| เว็บแอป Production ทำงานอยู่หรือไม่ | **FAIL — ไม่ทำงาน** | Vercel `402 DEPLOYMENT_DISABLED` (2026-10-25) |
| โดเมน Production | **FAIL — ไม่ผูก** | `dnaos.co.th` ไม่ resolve |
| Supabase Production (DB + 21 Edge Functions) | **PASS — ทำงาน** | REST/CLI ตอบสนอง, functions v146 ACTIVE |
| RLS ปิดกั้น anonymous | **PASS** | 12/12 ตาราง `*/0` |
| Schema ตรงกับ Source Code | **FAIL — drift** | `migration list` สองทาง |
| Function ที่รันจริงมี Source ในเครื่อง | **FAIL** | 3 ตัวรันโดยไม่มี source; 3 ตัวมี source แต่ไม่ถูก deploy |
| ต้นทุนดำเนินงานรายเดือนที่ยืนยันได้ | **NOT MEASURED** (มีใบเดียว $39.51 ยังไม่จ่าย) | `supabase_billing_events` 1 แถว |
| ต้นทุนพัฒนาที่แยกได้ | **PASS บางส่วน / COST_UNALLOCATED ส่วนใหญ่** | `subscription_services` 97 ใบไม่ซ้ำ |
| บัญชี 3 บัญชีมีจริงตามที่อ้าง | **PASS — 3 auth users, 3 profiles, 0 orphan** | GoTrue admin read + `profiles` |
| สิทธิ์รายบัญชี | **CONFIGURED + VERIFIED บางส่วน / OBSERVED น้อยมาก** | policy + audit 0.19% coverage |
| ต้นทุนต่อบัญชี | **NOT MEASURED** | ไม่มีคอลัมน์บัญชีใน `worker_usage_events` |
| CPU/RAM/GPU/Network ที่วัดได้ | **NOT MEASURED** | 0/104 แถวมีค่า telemetry |
| Storage 193 GB เป็นของ Production | **FAIL — ตีความผิด** | path เป็นดิสก์เครื่องพัฒนา |

---

# งานที่ 1 — ทรัพยากรประมวลผลและต้นทุนดำเนินงาน

## §1 SERVICE → SOURCE → RUNTIME → HOST → RESOURCE → COST

| # | SERVICE | SOURCE CODE | RUNTIME (ยืนยันแล้ว) | HOST | RESOURCE USAGE | COST EVIDENCE | สถานะ |
|---|---|---|---|---|---|---|---|
| S1 | DNA OS Web (Next.js 15, 335 API routes / 267 admin) | `app/**`, `middleware.ts` | **DISABLED** 2026-10-25 (`402 DEPLOYMENT_DISABLED`) | Vercel, region `sin1`, alias `dna-os-deadboard.vercel.app` | 0 (ไม่รับ request) | ใบ Vercel ใน `subscription_services` (ส.ค. USD 1,247.47 / ก.ย. USD 1.50) แต่ผูกกับบริการที่ปิดอยู่ → **COST_UNALLOCATED** | **FAIL** |
| S2 | `line-webhook-v2` (LINE ingress + AI orchestration) | `supabase/functions/line-webhook-v2/**` | **ACTIVE** v146, อัปเดต 2026-10-11T04:25Z | Supabase Edge (Seoul) | `line_events` 952 · `business_events` 214 · `ai_tasks` 385 | invocation/wall-clock ไม่มีมิเตอร์ → **NOT MEASURED** | **PASS (ทำงาน) / NOT MEASURED (ต้นทุน)** |
| S3 | Cron/automation functions 12 ตัว (`debt-reminder-cron`, `fuel-price-sync`, `bank-email-sync`, `receipt-reconcile-sweep`, `subscription-email-sync`, `supabase-billing-sync`, `system-health-check`, `storage-threshold-alert`, `architecture-drift-alert`, `equipment-maintenance-cron`, `stuck-message-sweep`, `quotation-queue-nudge`) | `supabase/functions/<name>/**` | **ACTIVE** (deploy date 2026-08-03 → 2026-08-26) | Supabase Edge (Seoul) | ตาราง cron ไม่เปิดให้อ่าน → จำนวนรอบ **NOT VERIFIED** | ไม่มีมิเตอร์ | **BLOCKED** |
| S4 | งานที่รันจริงแต่**ไม่มี Source ในเครื่อง** 3 ตัว (`stuck-message-sweep`, `provider-alert-email-read`, `tiktok-oauth-support`) | **ไม่มีใน repo** | ACTIVE | Supabase Edge | ไม่ทราบ | ไม่ทราบ | **FAIL** |
| S5 | งานที่มี Source แต่**ไม่ถูก deploy** 3 ตัว (`back-to-back`, `kis-webhook`, `scout-map`) | มีใน repo | ไม่ทำงาน | — | 0 | 0 | **PASS (ไม่คิดต้นทุน)** |
| S6 | PostgreSQL (118 ตาราง) | `supabase/migrations/**` (ไม่ตรง runtime) | **ACTIVE** | Supabase (Seoul) | 118 ตาราง · `audit_logs` 4,848 · `receipt_documents` 495 · DB size **NOT MEASURED** | ใบ Supabase USD 39.51 = THB 1,325.83 (2026-07-27) ยังไม่จ่าย | **PASS (ทำงาน) / ต้นทุน NOT MEASURED** |
| S7 | Storage bucket `attachments` (private) | — | **ACTIVE** (สร้าง 2026-07-07) | Supabase Storage | **bytes NOT MEASURED** (ไม่เปิด storage schema ผ่าน REST) | อยู่ในใบ Supabase เดียวกัน | **BLOCKED** |
| S8 | GPU Worker (RunPod) `qwen2.5vl:72b` | `app/api/admin/ide/_lib/usageMeterRuntime.ts`, adapters | **ไม่พบการใช้งานหลัง 2026-08-15T08:29Z** → สถานะปัจจุบัน **NOT VERIFIED** | RunPod (1 pod) | 104 events · 132,771 tokens · latency รวม 3,621,667 ms (≈60.4 นาที) · GPU/CPU/RAM telemetry 0/104 | RunPod USD 572.65 (ส.ค. 571.38 / ก.ย. 1.27) | **NOT MEASURED** |
| S9 | AI Coding (Cline) | `ai_tasks.kind = owner_cline_command` | **ACTIVE** (ต.ค. 2026: done 59 / failed 207) | เครื่องพัฒนา (Mac) | 266 tasks | Anthropic USD 774.81 + OpenAI USD 110.90 (ส.ค., dedupe) = **Development** | **PASS (แยกเป็นต้นทุนพัฒนาได้)** |
| S10 | Storage Intelligence scanner | `scripts/`, `storage_scan_runs` | **ACTIVE ตามรอบสแกน** (27 runs, 6 machines, actor `scheduler` 12) | Mac ของเจ้าของ + เครื่องอื่น (`/root`) | สแกน 193.17 GB **บนดิสก์ท้องถิ่น** (npm cache 49.26 / .cache 50.73 / .ollama 33.58 / Desktop 33.62 / Library 25.98 GB) | **ไม่ใช่ต้นทุน Production** — ค่าไฟ **NOT MEASURED** | **PASS (แยกออกจาก Production)** |
| S11 | Supabase staging | `supabase/**` | **ACTIVE แต่ 0 functions** (REST 401 = alive) | Supabase (Singapore) | 0 function, ไม่มีข้อมูลที่ตรวจ | ไม่มีใบ → **NOT VERIFIED** | **BLOCKED** |
| S12 | Email ingestion (Gmail → subscriptions/bank) | `subscription-email-sync`, `bank-email-sync` | ACTIVE (2026-08-03) | Supabase Edge | 825 subscription rows ถูกสร้าง, 143 มีจำนวนเงิน | ต้นทุน Gmail = 0 (ไม่พบใบ) | **PASS** |
| S13 | LINE Messaging API | `supabase/functions/line-webhook-v2/**`, `line_events` | ACTIVE | LINE (ภายนอก) | 952 events (in 583 / out 369) · เดือน ล่าสุด 2026-10 | ไม่พบใบ LINE → **NOT MEASURED** | **NOT MEASURED** |

### 1.1 Dependency ที่ขาดใน Runtime (สำคัญต่อต้นทุน/ความถูกต้อง)

`supabase/functions/_shared/connect-price.ts:40` เรียก `${appUrl}/api/internal/connect/material-price` กลับเข้าเว็บแอป — แต่ S1 ปิดอยู่ (`402`) จึงพิสูจน์ได้ว่า **เส้นทางบันทึกราคาซื้อขายจาก LINE ใช้งานไม่ได้ในปัจจุบัน** (ตรวจจาก topology + สถานะ host ไม่ได้ยิงทดสอบ เพราะจะเป็นการเขียนข้อมูล)

### 1.2 ตารางสรุป: อะไรเปิดตลอด / ตามคำขอ / ไม่ได้ใช้

| ลักษณะ | รายการ |
|---|---|
| เปิดตลอด (always-on) | Supabase Postgres + Storage, 21 Edge functions (idle cost ตามแพลตฟอร์ม) |
| ตามคำขอ (request-driven) | LINE webhook, AI worker (RunPod เมื่อถูกเรียก), API ภายนอก |
| ไม่ได้ใช้งาน | เว็บแอป Vercel (ปิด), 3 functions ที่มี source แต่ไม่ deploy, staging (0 functions) |
| ใช้เฉพาะพัฒนา | Cline/AI coding, storage scanner, benchmark worker, Mac |

---

## §2 ต้นทุนดำเนินงานจริง (OPERATING COST)

**หลักการ:** นับเฉพาะที่มีหลักฐานว่าเป็น Production และไม่ซ้ำกับตารางอื่น

| รายการ | จำนวน | สกุล | วันที่/รอบ | สถานะการจ่าย | หลักฐาน | Evidence Status |
|---|---|---|---|---|---|---|
| Supabase (ค่าบริการโครงการ Production) | 39.51 | USD | 2026-07-27 | **ยังไม่จ่าย** (`owner_notified`; `partner_payable_requests` pending 1,325.83 THB) | `supabase_billing_events` 1 แถว; `partner_payable_requests` 1 แถว | **PASS (มีใบ) / การจ่าย FAIL** |
| Supabase แปลงเป็นบาทตามที่ระบบบันทึก | 1,325.83 | THB | 2026-07-27 | ยังไม่จ่าย | อัตราที่ระบบใช้ = 1,325.83 ÷ 39.51 = **33.55 THB/USD** (อัตราของระบบ ไม่ใช่อัตราตลาด) | **PASS** |
| ค่า Server อื่นสำหรับ Production | ไม่พบ | — | — | — | ไม่มีใบที่ระบุว่าเป็น DNA OS Production | **NOT MEASURED** |
| Database add-on / compute add-on | ไม่พบ | — | — | — | ไม่มีหลักฐานแยก | **NOT MEASURED** |
| Storage & Backup ของ Production | ไม่พบ | — | — | — | bucket มี 1 แต่ไม่มีมิเตอร์ | **NOT MEASURED** |
| AI Inference ของ Production | 0 ที่พิสูจน์ได้ | — | — | — | `COST_LEDGER.json` entries = **0**; `COMPUTE_RESOURCE_REGISTRY.json` resources = **0** | **NOT MEASURED** |
| Network / Data transfer | ไม่พบ | — | — | — | ไม่มีมิเตอร์ | **NOT MEASURED** |
| โดเมน | ไม่พบ | — | — | — | `dnaos.co.th` ไม่ resolve = ยังไม่ผูก = ไม่มีต้นทุน serving | **FAIL (ไม่ผูก) / NOT MEASURED (ค่าโดเมน)** |
| ค่าไฟฟ้าเครื่องที่ประมวลผล Production | ไม่มีข้อมูลวัด | — | — | — | ไม่มี watt-meter | **NOT MEASURED** |

### 2.1 คำตอบตรง ๆ: "DNA OS จ่ายค่าใช้ระบบ Production เดือนละเท่าไร"

> **ยืนยันได้เพียง 1,325.83 THB (39.51 USD) จากใบ Supabase 1 ใบ ณ 2026-07-27 และยังไม่จ่าย**
> **ตัวเลขรายเดือน (monthly run-rate) ของ Production = NOT MEASURED** เพราะ (ก) ไม่มีใบรอบ ส.ค.–ต.ค. ของ Supabase เลย (ข) ใบ Vercel ที่มีอยู่ไม่สามารถพิสูจน์ได้ว่าเป็นของ DNA OS ส่วนไหน (ค) เว็บแอปถูกปิดอยู่ จึงไม่มี compute ที่นับได้ในปัจจุบัน

### 2.2 SHARED COST ที่ยังแยกไม่ได้

| ทรัพยากร | ใช้ทั้ง Production และพัฒนา | หลักฐานสัดส่วน | สถานะ |
|---|---|---|---|
| Vercel (1 บัญชี/1 ทีม) | ใช่ — ใบ ส.ค. USD 1,247.47 มีทั้ง preview/dev/production | ไม่มี breakdown ต่อ project → ใช้ไม่ได้ | **COST_UNALLOCATED** |
| Supabase (1 org 2 projects) | ใช่ — Production + staging | ไม่มีใบแยกต่อ project | **COST_UNALLOCATED** |
| Hostinger (THB 4,604.65 + USD 450 ส.ค.) | ไม่ทราบว่าโฮสต์อะไรของ DNA OS | ไม่มี mapping ไปยัง service | **COST_UNALLOCATED** |
| Mac ของเจ้าของ | ใช่ — dev + storage scan + benchmark | ไม่มีชั่วโมงแยกงาน | **COST_UNALLOCATED** |

---

## §3 ต้นทุนพัฒนา (DEVELOPMENT COST) — แยกต่างหาก

**ที่มา:** `subscription_services` 825 แถว → **143 แถวมีจำนวนเงิน > 0** → dedupe ตาม (provider + service + amount + currency + วัน) เหลือ **97 ใบไม่ซ้ำ**
**ข้อจำกัด:** ยังไม่กระทบยอดกับใบจริงของผู้ให้บริการ → ตัวเลขนี้เป็น **"ใบที่ระบบดักได้ (deduped)"** ไม่ใช่ "ยอดที่จ่ายจริงทั้งเดือน"

### 3.1 ส.ค. 2026 (เดือนที่มีข้อมูลครบที่สุด)

| Provider | สกุล | ใบไม่ซ้ำ | ยอดดิบ (ก่อน dedupe) | ยอด deduped | การจัดประเภท |
|---|---|---|---|---|---|
| Anthropic (Claude) | USD | 12 | 1,199.81 | **774.81** | DEVELOPMENT (AI coding) |
| OpenAI | USD | 3 | 110.90 | **110.90** | DEVELOPMENT (AI coding) |
| RunPod (GPU) | USD | 17 | 571.38 | **571.38** | DEVELOPMENT (AI worker/benchmark) |
| Vercel | USD | 15 | 1,727.47 | **1,247.47** | **SHARED / COST_UNALLOCATED** |
| Hostinger | USD | 1 | 450.00 | **450.00** | **COST_UNALLOCATED** (ไม่ยืนยันว่าโฮสต์ DNA OS) |
| Hostinger | THB | 8 | 4,604.65 | **4,604.65** | **COST_UNALLOCATED** |
| Google | THB | 7 | 8,631.74 | **2,774.74** | **COST_UNALLOCATED** (mixed Google AI/One) |
| Apple | THB | 13 | 9,582.97 | **7,248.97** | **COST_UNALLOCATED** (mixed) |
| OpenAI | THB | 1 | 653.27 | **653.27** | DEVELOPMENT |
| Vercel | THB | 1 | 90.00 | **5.00** | SHARED |
| **รวม ส.ค.** | USD | 48 | 4,059.56 | **3,154.56** | — |
| **รวม ส.ค.** | THB | 29 | 23,562.63 | **15,286.63** | — |

### 3.2 ก.ย. 2026

| Provider | สกุล | ใบ | ยอด | การจัดประเภท |
|---|---|---|---|---|
| Anthropic | USD | 3 | 321.00 | DEVELOPMENT |
| Hostinger | USD | 1 | 450.00 | COST_UNALLOCATED |
| GitHub | USD | 1 | 10.00 | DEVELOPMENT |
| OpenAI | USD | 1 | 3.00 | DEVELOPMENT |
| RunPod | USD | 3 | 1.27 | DEVELOPMENT |
| Vercel | USD | 1 | 1.50 | SHARED |
| Google | USD | 1 | 0.01 | COST_UNALLOCATED |
| Google | THB | 2 | 3,500.00 | COST_UNALLOCATED |
| Hostinger | THB | 3 | 1,737.00 | COST_UNALLOCATED |
| Apple | THB | 3 | 1,227.00 | COST_UNALLOCATED |
| **รวม ก.ย.** | USD / THB | 17 | **786.78 / 6,464.00** | — |

### 3.3 ต.ค. 2026

**ไม่พบใบใด ๆ ในระบบ (0 แถว)** — ไม่ได้แปลว่าไม่มีการจ่าย แต่แปลว่า**ระบบดักใบไม่ทำงานในเดือนนี้** → **NOT MEASURED**

### 3.4 ระดับความมั่นใจของตัวเลขต้นทุน

| ระดับ | รายการ | เหตุผล |
|---|---|---|
| มีหลักฐานจริง (จ่าย/ใบ) | Supabase 39.51 USD | มี event + payable record |
| มีหลักฐานแต่ยังไม่กระทบยอด | ใบ ส.ค./ก.ย. 97 ใบ | เป็น email capture, ไม่มีเลขใบสั่งซื้อ/ใบกำกับจริง, 0/143 มี `next_billing_date` |
| หลักฐานอ่อน | `company_expenses` subscription 145 แถว (ส.ค. 126 = 27,622.19 THB) | **อาจเป็นรายการเดียวกับ `subscription_services`** → ห้ามบวกซ้ำ |
| ไม่มีหลักฐาน | ต.ค., ค่าไฟ, Data transfer, AI inference cost | — |

**จึงสรุปได้แค่:** ต้นทุนพัฒนาที่ตรวจสอบได้ขั้นต่ำ (dedupe) = **ส.ค. USD 1,457.09 + THB 15,286.63** ในหมวด DEVELOPMENT/SHARED และ **ยังมีอีก 8,000+ THB/USD ที่จัดประเภทไม่ได้ (COST_UNALLOCATED)**

---

# งานที่ 2 — บัญชีผู้ใช้ 3 บัญชีใน Production

## §4 บัญชีจริงจากฐานข้อมูล (ไม่ใช้ตัวเลขรายงานเก่า)

**แหล่ง:** GoTrue admin read (`/auth/v1/admin/users`) + `public.profiles` + `org_members` — snapshot 2026-10-24T22:06Z
**ความสอดคล้อง:** auth users **3** · profiles **3** · `auth_without_profile = 0` · `profile_without_auth = 0` → **PASS**

| # | Account (masked) | Role | Org / สังกัด | สร้างเมื่อ | ล็อกอินล่าสุด (UTC) | Email confirmed |
|---|---|---|---|---|---|---|
| A | `acct_39cbd71c` | `super_admin` | organization #1 — **owner** | 2026-07-08T17:12:23Z | **2026-10-24T18:23:32Z** | yes |
| B | `acct_2d06e2d6` | `super_admin` | organization #1 — **admin** | 2026-07-08T16:51:40Z | **2026-10-19T13:19:59Z** | yes |
| C | `acct_8de1e3b9` | `customer` | **ไม่มี org** (0 membership) | 2026-10-15T10:04:19Z | **2026-10-18T15:43:23Z** | yes |

**ข้อสังเกตสำคัญ vềบัญชี C:** โดเมนอีเมลเป็น `example.com` (โดเมนสงวนตาม RFC 2606 สำหรับเอกสาร/ทดสอบ) + ไม่มี org + ไม่มีกิจกรรมใด ๆ → **มีหลักฐานว่าเป็นบัญชีทดสอบ ไม่ใช่ลูกค้าจริง** (ไม่เปิดเผยอีเมล)

---

## §5 สิทธิ์สามระดับ: CONFIGURED / VERIFIED / OBSERVED

### 5.1 บัญชี A — `acct_39cbd71c` (super_admin, org owner)

| ระดับ | รายการ | หลักฐาน |
|---|---|---|
| **CONFIGURED** | ทุก route ใน `route_access`: `/admin`, `/business`, `/partner`, `/user` · `admin_tier` + `super_admin_only` ครบ · `workspace_landing = /admin/relationships` | `registry/permissions.json:38,43,56,84,253` |
| **CONFIGURED** | API: `/api/admin/**` (267 routes), `/api/document`, `/api/action`, `/api/explain` · `/api/admin/users` + `/api/admin/backup` เฉพาะ super_admin | `permissions.json: api_access`; `middleware.ts:29`; `requireAuth.ts:24` |
| **CONFIGURED** | 14 business tools ใน `/workspace` (documents, search, chat, connections, changes, problems, history, accounting, finance, jobs, people, vehicles, materials, transfer) | `permissions.json: capability_access` |
| **CONFIGURED** | ออก/เพิกถอน API token ให้ AI ภายนอกได้ (`scope: read` เท่านั้น) | `services/supabase/api-tokens.ts:47`; `app/api/v1/query/route.ts:80` |
| **VERIFIED** | anonymous เข้าถึงข้อมูลไม่ได้ (RLS deny 12/12 ตาราง) — ยืนยันด้วย anon key จริง | `content-range: */0` |
| **VERIFIED** | role ที่ไม่ผ่าน `permissions.json` ถูกปฏิเสธ 403 ที่ API และ redirect ที่หน้า | `requireAuth.ts:24`, `requireAuthPage.ts:16` |
| **OBSERVED** | 2 actions: `pit_profile.updated` + `pit_profile.deactivated` @ 2026-10-14T03:05Z / 03:19Z | `audit_logs` (actor = acct_39cbd71c) |
| **OBSERVED** | AI tasks ที่เป็นเจ้าของ: **1** รายการ | `ai_tasks.owner_user_id` |
| **NOT VERIFIED** | เคยเข้าถึง/แก้ไขข้อมูลขององค์กรอื่นหรือไม่ | ไม่มี log ที่ผูก actor + company ได้ครบ — `audit_logs` มี actor เพียง 9 จาก 4,848 แถว |
| **NOT VERIFIED** | 11 ครั้งของ `admin_session|ADMIN_LOGIN` เป็นของใคร | `actor_user_id = null` |

### 5.2 บัญชี B — `acct_2d06e2d6` (super_admin, org admin)

| ระดับ | รายการ | หลักฐาน |
|---|---|---|
| **CONFIGURED** | เหมือน A ในเชิง role (super_admin = สิทธิ์เต็ม) ต่างที่ membership ใน org เป็น `admin` ไม่ใช่ `owner` | `org_members` role=admin; `permissions.json:43` |
| **VERIFIED** | ผ่าน guard เดียวกันทั้งหมด (ไม่มี role พิเศษซ่อนอยู่ — ตรวจ `permissions.json` แล้วไม่มี branch ตาม org role) | `permissions.json` ทั้งไฟล์ |
| **OBSERVED** | **265 AI tasks** เป็นเจ้าของ — หมวด `owner_cline_command` (ต.ค.: done 59 / **failed 207**) | `ai_tasks` |
| **OBSERVED** | audit ที่ผูกกับบัญชีนี้: **0 แถว** | `audit_logs.actor_user_id` |
| **NOT MEASURED** | ทรัพยากรที่ใช้: token ที่ AI coding ใช้ ไม่ถูกบันทึกที่ระดับบัญชี | `worker_usage_events` ไม่มีคอลัมน์ user |

### 5.3 บัญชี C — `acct_8de1e3b9` (customer, บัญชีทดสอบ)

| ระดับ | รายการ | หลักฐาน |
|---|---|---|
| **CONFIGURED** | เข้าได้เฉพาะ `/user` (role customer อยู่ใน route_access `/user` เท่านั้น) · landing = `/user` | `permissions.json:84,253`; `app/user/layout.tsx:16` |
| **CONFIGURED** | `/api/explain` เท่านั้นในฝั่ง API ที่ customer อยู่ในรายการ | `permissions.json: api_access /api/explain` |
| **CONFIGURED** | **ไม่ใช่** admin_tier → `/api/admin/**` 267 routes ปฏิเสธ 403 | `requireAuth.ts:24` |
| **VERIFIED** | หน้า `/user` เป็นข้อมูล static จาก `registry/existence.json` — **ไม่มีการอ่านข้อมูลธุรกิจ/เอกสาร/แชตของผู้ใช้เลย** | `app/user/page.tsx:26` (อ่าน `existence.capabilities`) |
| **VERIFIED** | ไม่มี org membership → ไม่มีเส้นทางไปยัง `company_id` ใด ๆ | `org_members` = 2 แถว (A, B เท่านั้น) |
| **VERIFIED** | ไม่มี API token ที่ออกให้บัญชีนี้ | `api_tokens` 4 ใบ — โดเมนอีเมลของผู้ถือ token ไม่ตรงกับบัญชี C (ไม่เปิดเผยอีเมล) |
| **OBSERVED** | 0 audit · 0 AI task · 0 payment · 0 business event ที่ผูกกับบัญชี | ตารางที่เกี่ยวข้องทั้งหมด |
| **NOT VERIFIED** | storage ที่เป็นของบัญชีนี้ | `storage_resources` ไม่มีคอลัมน์ owner |
| **OBSERVED** | ล็อกอิน 1 ครั้งล่าสุด 2026-10-18T15:43Z, confirmed email | GoTrue |

**สรุปความต่างของ 3 บัญชี:**

| มิติ | A (owner) | B (admin) | C (customer) |
|---|---|---|---|
| ระดับสิทธิ์ | super_admin เต็ม | super_admin เต็ม (ต่างแค่ org role) | customer — หน้า static หน้าเดียว |
| เข้าถึงข้อมูลธุรกิจ | ได้ (ตาม policy) | ได้ (ตาม policy) | **ไม่ได้** |
| สร้าง/แก้/ลบเอกสาร | ได้ | ได้ | ไม่ได้ |
| เรียก AI | ได้ (1 task) | ได้ (265 tasks — dev) | ไม่ได้ |
| API token | เป็นผู้ออก token | ใช้ผ่าน UI | ไม่มี |
| Storage ที่เป็นเจ้าของ | ยังแยกไม่ได้ | ยังแยกไม่ได้ | **ไม่ยืนยัน** (ไม่มีคอลัมน์ owner) |
| ต้นทุนที่ตรวจสอบได้ | **NOT MEASURED** | **NOT MEASURED** | **0** |

> **ข้อควรระวังตามคำสั่ง:** "มีสิทธิ์" ≠ "เคยใช้". ทั้ง A และ B มีสิทธิ์เต็มโดย CONFIGURED แต่หลักฐานการใช้งานจริงมีเพียง 2 (A) และ 0 (B) แถวใน audit — ที่เหลือเป็น UNATTRIBUTED

---

## §6 กิจกรรมจริงรายบัญชี: ACCOUNT → SESSION → ACTION → CAPABILITY → API/TOOL → TRACE → RESOURCE

### 6.1 ตารางกิจกรรมที่ตรวจสอบย้อนกลับได้

| ACCOUNT | SESSION | ACTION | CAPABILITY | API/TOOL | TRACE | RESOURCE |
|---|---|---|---|---|---|---|
| A `acct_39cbd71c` | Supabase Auth cookie, ล่าสุด 2026-10-24T18:23Z | `pit_profile.updated` (2026-10-14T03:05:58Z) | materials/pits | `/api/admin/pits/**` | `audit_logs` id (actor=A) | 1 write |
| A | เดียวกัน | `pit_profile.deactivated` (2026-10-14T03:19:02Z) | materials/pits | `/api/admin/pits/**` | `audit_logs` (actor=A) | 1 write |
| A | เดียวกัน | AI task 1 รายการ | AI (worker) | dispatcher → worker | `ai_tasks.owner_user_id = A` | tokens: ไม่บันทึกที่ระดับบัญชี |
| B `acct_2d06e2d6` | Auth, ล่าสุด 2026-10-19T13:19Z | 265 AI coding commands (ต.ค.: 59 done / 207 failed) | AI coding (dev) | `/api/admin/ide/**` → Cline | `ai_tasks.owner_user_id = B` | **NOT MEASURED** |
| B | — | 0 canonical audit actions | — | — | — | 0 |
| C `acct_8de1e3b9` | Auth, 2026-10-18T15:43Z | เปิดหน้า `/user` (ตาม CONFIGURED) | none (static) | — | ไม่มี audit | ~0 |
| **UNATTRIBUTED** | — | `connector.run` **4,342** ครั้ง | connectors (dev/ops) | gateway | `audit_logs` actor=null | ไม่ทราบ |
| **UNATTRIBUTED** | — | `ai_invocation.ai.invocation` **155** ครั้ง | AI | ยังไม่มี actor | `audit_logs` actor=null | tokens: ไม่ทราบ |
| **UNATTRIBUTED** | — | `document_artifact.artifact.created` 46 · `invoices.document.*` 73 · `business_failure_bridge PROVIDER_AUTH` **43** | documents/finance | canonical writers | `audit_logs` actor=null | ไม่ทราบ |
| **UNATTRIBUTED** | LINE identity | 952 `line_events`, 214 `business_events`, 495 receipts | LINE/Connect | `line-webhook-v2` | `line_user_id` (ไม่ใช่ account) | ไม่ทราบ |

### 6.2 อัตราการผูกบัญชี (ตัวเลขที่ทำให้ต้นทุนรายบัญชีเป็นไปไม่ได้ในตอนนี้)

| ตาราง | แถวทั้งหมด | มี actor/account | ไม่มี | Coverage |
|---|---|---|---|---|
| `audit_logs` | **4,848** | **9** | **4,839** | **0.19%** |
| `company_expenses` | 149 | 4 | 145 | 2.7% |
| `line_events` | 952 | 952 (`line_user_id`) | 0 | **แต่ไม่ใช่ account** |
| `worker_usage_events` | 104 | **0** (ไม่มีคอลัมน์บัญชี) | 104 | **0%** |
| `ai_tasks` | 385 | 266 (`owner_user_id`) | 119 | 69% |
| `document_versions` | 123 | 123 (`created_by`) | 0 | **แต่ hash ไม่ตรงกับ 3 บัญชี** |

**ข้อค้นพบเชิงโครงสร้างที่สำคัญที่สุดของรายงานนี้:**

1. `engines/canonical/audit.ts:78` เขียน `actor_user_id: null` **แบบตายตัว** ทั้งที่บรรทัด 72–74 บังคับให้ต้องมี `actor` — จึงเป็นสาเหตุตรงของ 4,839 แถวที่ผูกบัญชีไม่ได้
2. `document_versions.created_by` เก็บค่า `acct_f74ee940` (13), `acct_895adfe5` (109), `acct_938ea3f3` (1) ซึ่ง **ไม่ตรงกับบัญชี A/B/C** → เป็น id จากคนละ layer (LINE/identity เดิม) → ผูกกับ 3 บัญชีไม่ได้
3. `ai_tasks` ทั้ง 385 แถวมี `line_user_id` แต่มีเพียง 266 แถวที่มี `owner_user_id`
4. `identity_memberships` มี `acct_eed24c45` (super_admin) + `acct_f810279c` (platform_owner) ที่ **ไม่มีใน `profiles`** → identity layer กับ auth layer นับบัญชีไม่ตรงกัน

---

## §7 พื้นที่จัดเก็บ แยกบัญชี / องค์กร / ส่วนกลาง

| ชั้นพื้นที่ | ตำแหน่ง | ขนาด | เจ้าของที่พิสูจน์ได้ | หลักฐาน | สถานะ |
|---|---|---|---|---|---|
| ดิสก์เครื่องพัฒนา (Mac) | `/Users/tam/.npm` 21 paths | 49.26 GB | เจ้าของเครื่อง (dev) | `storage_resources.path`, `storage_scan_runs.roots_scanned` | **PASS — ไม่ใช่ Production** |
| ดิสก์เครื่องพัฒนา (Mac) | `/Users/tam/.cache` 16 paths | 50.73 GB | dev cache | เดียวกัน | **PASS** |
| ดิสก์เครื่องพัฒนา (Mac) | `/Users/tam/.ollama` 3 paths | 33.58 GB | dev (โมเดล AI) | เดียวกัน | **PASS** |
| ดิสก์เครื่องพัฒนา (Mac) | `/Users/tam/Desktop` 36 paths | 33.62 GB | dev (รวม repo) | เดียวกัน | **PASS** |
| ดิสก์เครื่องพัฒนา (Mac) | `/Users/tam/Library` 15 paths | 25.98 GB | dev | เดียวกัน | **PASS** |
| เครื่องอื่น (`/root`) | 2 paths | 1.3 KB | ไม่ทราบ | `root/.npm` | **UNATTRIBUTED** |
| **รวมที่ระบบรายงานว่า 193 GB** | — | **193,166,499,256 bytes** | — | — | **FAIL ถ้าใช้เป็นตัวเลข Production** |
| Supabase Storage `attachments` (private) | bucket เดียว | **NOT MEASURED** | ไม่มีคอลัมน์ owner ใน `storage_resources` (`id, scan_run_id, path, size_bytes, sha256, modified_at, state, created_at`) | OpenAPI + `/storage/v1/bucket` | **BLOCKED** |
| เอกสาร/artifact ในระบบ | `document_artifacts` 46 (image 41 / pdf 5) | 284,139 bytes (278 KB) | `created_by` เป็น legacy hash | `document_artifacts` | **UNATTRIBUTED** |
| Backup | ไม่พบที่จัดเก็บที่ยืนยันได้ | — | — | ไม่มี bucket/ตาราง backup | **NOT MEASURED** |

**คำตอบ §5 ของคำสั่ง:** Usage Metering **ยังระบุเจ้าของพื้นที่ไม่ได้** — `storage_resources` ไม่มี `user_id`/`company_id` เลย และ 27 scan runs มาจาก 6 เครื่อง (actor: `scheduler` 12, `smoke-test` 6, `owner-account` 6, `migrate-ollama-cli` 3) ซึ่งเป็นงาน ops/dev ไม่ใช่ผู้ใช้บริการ

---

## §8 AI / API / Compute Usage (ที่มีหลักฐานจริง)

| ตัวชี้วัด | ค่าจริง | ช่วงเวลา | หลักฐาน | สถานะ |
|---|---|---|---|---|
| AI tasks ทั้งหมด | **385** | 2026-07-25 → 2026-10-20 | `ai_tasks` | **PASS** |
| — `owner_cline_command` (dev) | 266 (failed 207, done 59) | ต.ค. 2026 | `ai_tasks.kind` | **PASS** |
| — `handle_text` (บริการจริง) | 65 (done 20, pending 47) | ก.ค.–ต.ค. | `ai_tasks` | **PASS** |
| — `classify_image` (บริการจริง) | 54 (done 49, pending 5) | ก.ค.–ส.ค. | `ai_tasks` | **PASS** |
| Worker usage events | **104** | **2026-08-14 → 2026-08-15 เท่านั้น** | `worker_usage_events` | **PASS** |
| — tokens | 132,771 (input 102,499 / output 30,272) | 2 วัน | เดียวกัน | **PASS** |
| — โมเดล | `qwen2.5vl:72b` 50 · `thawatchai` 41 · `stub-model` 13 | — | `worker_usage_events.model` | **PASS** |
| — งานจริง vs benchmark | `benchmark:*` 89 · `code.generate` 13 · **`handle_text` 1 · `classify_image` 1** | — | `worker_usage_events.service` | **PASS — งานลูกค้าจริงแค่ 2 ครั้ง** |
| — latency รวม | 3,621,667 ms (≈60.4 นาที) | 2 วัน | `latency_ms` | **PASS** |
| — CPU / RAM / GPU / VRAM / Network / Disk | **0/104 แถวมีค่า** | — | probe นับ non-null | **NOT MEASURED** |
| AI invocation ที่ระบบบันทึก | 155 (`ai_invocation`) | — | `audit_logs` actor=null | **UNATTRIBUTED** |
| Provider auth ล้มเหลว | **43** (`business_failure_bridge PROVIDER_AUTH`) | — | `audit_logs` | **FAIL (ต้องเฝ้า)** |
| API tokens | 4 (revoked 1, ใช้แล้ว 3, scope `read` ทั้งหมด, ใช้ล่าสุด 2026-08-04) | — | `api_tokens` | **PASS** |
| API routes ที่มีในโค้ด | 335 (admin 267) | — | `find app/api -name route.ts` | **ไม่ใช่ปริมาณการใช้** |

**ข้อสรุป §6 ของคำสั่ง:** ไม่มี telemetry ที่ให้ต้นทุนต่อการเรียกได้ — `worker_usage_events` มี 38 คอลัมน์ (มี `network_bytes_sent`, `disk_bytes_read`, `gpu_util_pct`, ฯลฯ) แต่ **ไม่มีคอลัมน์ cost และไม่มีคอลัมน์บัญชี/บริษัท** → ต้นทุนต่อ execution = **NOT MEASURED**

---

## §9 ต้นทุนต่อความสามารถ (เฉพาะที่วัดได้จริง)

| ความสามารถ | จำนวนที่เรียก | ระยะเวลา | CPU/RAM/GPU | DB R/W | Network | AI tokens | ต้นทุนต่อครั้ง | สถานะ |
|---|---|---|---|---|---|---|---|---|
| LINE webhook → AI text | 65 tasks (1 worker run) | latency ไม่ครบ (1 แถว) | 0 | ไม่วัด | ไม่วัด | ไม่ทราบ | **NOT MEASURED** | NOT MEASURED |
| LINE webhook → classify image | 54 tasks (1 worker run) | — | 0 | ไม่วัด | ไม่วัด | ไม่ทราบ | **NOT MEASURED** | NOT MEASURED |
| AI worker (benchmark) | 89 runs | 3.62M ms รวม | 0 | ไม่วัด | 0 | 132,771 tokens | **NOT MEASURED** (ไม่มีราคาต่อ token ที่บันทึก) | NOT MEASURED |
| เอกสาร (issue/void) | 73 audit actions | — | — | ไม่วัด | — | — | **NOT MEASURED** | NOT MEASURED |
| รับสลิป/อ่านใบเสร็จ | 495 receipts (ai_read 492) | — | — | ไม่วัด | — | ไม่ทราบ | **NOT MEASURED** | NOT MEASURED |
| Connector run | **4,342** | — | — | ไม่วัด | — | — | **NOT MEASURED** | UNATTRIBUTED |

**ห้ามนำต้นทุนเหมารายเดือน (เช่น 1,325.83 THB) มาหารจำนวน API call** เพราะ (ก) เป็นคนละรอบบิล (ข) ไม่รู้ว่าส่วนใดเป็นของ call ไหน (ค) ตัวหาร (4,342 หรือ 335 หรือ 952) ไม่ใช่หน่วยบริการเดียวกัน

---

## §10 Telemetry ที่ยังขาด + ตำแหน่ง Source Code ที่ต้องเพิ่มการวัด

| # | สิ่งที่ขาด | ผลกระทบ | ตำแหน่งที่ต้องแก้ (ยังไม่แก้ตามคำสั่ง) |
|---|---|---|---|
| M1 | `audit_logs.actor_user_id` ถูกเขียนเป็น `null` ตายตัว | 4,839/4,848 แถวผูกบัญชีไม่ได้ (99.81%) | `engines/canonical/audit.ts:78` |
| M2 | `worker_usage_events` ไม่มี `user_id`/`company_id`/`cost_usd` | ต้นทุน AI ต่อบัญชี = 0 ที่วัดได้ | `supabase/migrations/20260810000002_worker_usage_events.sql` + `app/api/admin/ide/_lib/usageMeterRuntime.ts:68` |
| M3 | `COST_LEDGER.json` entries = 0 · `COMPUTE_RESOURCE_REGISTRY.json` resources = 0 | ไม่มีที่เก็บต้นทุนจริงต่อ execution | `registry/COST_LEDGER.json`, `registry/COMPUTE_RESOURCE_REGISTRY.json`, `app/api/admin/ide/_lib/costGateRuntime.ts#recordActualCost` |
| M4 | CPU/RAM/GPU/VRAM/Network/Disk 0/104 | วัด resource ต่อ run ไม่ได้ | telemetry sampler ที่เขียน `worker_usage_events` (คอลัมน์มีแล้ว) |
| M5 | `storage_resources` ไม่มี owner (user/company) | แยกพื้นที่ผู้ใช้/องค์กรไม่ได้ | `supabase/migrations/20260804000004_storage_intelligence.sql` |
| M6 | `document_versions.created_by` เป็น legacy hash ไม่ตรง auth account | เจ้าของเอกสาร 123 เวอร์ชันระบุไม่ได้ | writer ของ `document_versions` (canonical document write path) |
| M7 | ไม่มีที่-map LINE identity → auth account | 952 events + 214 business events เป็น UNATTRIBUTED | `connect_external_identities` (มี `company_id` แต่ไม่มี `profile_id`), `core/identity/identity.ts` |
| M8 | ไม่มีการเก็บ usage ของ Supabase (DB size, function invocations, storage bytes) | ต้นทุนต่อบริการยืนยันไม่ได้ | ยังไม่มี script; ต้องใช้ Management API/usage endpoint |
| M9 | `subscription_services` ไม่มี invoice id / dedupe key, 0/143 มี `next_billing_date` | 825 แถว → 97 ใบจริง, ยอดอาจซ้ำ | `supabase/functions/subscription-email-sync/**` |
| M10 | cron schedule ไม่ถูกเก็บในระบบที่ตรวจได้ | ไม่รู้รอบการทำงานของ 12 functions | `supabase/migrations/20260711000003_debt_reminder_cron.sql` และไฟล์ cron อื่น (คำสั่ง `cron.schedule` ถูก comment ไว้ทั้งไฟล์) |
| M11 | ไม่มี watchdog ของ deployment state | เว็บ Production ปิด (402) โดยไม่มีการแจ้งในระบบ | ไม่มี script; ตรวจพบโดย `curl` เท่านั้น |
| M12 | Schema drift ไม่ถูกบล็อก | 118 ตารางจริง ≠ migration ในเครื่อง, 6 migration อยู่แต่บน Production | `scripts/check-drift.sh`, `supabase/migrations/**` |

---

## §11 คำตอบสุดท้าย (7 ข้อที่คำสั่งกำหนด)

**1) DNA OS จ่ายค่าใช้ระบบ Production จริงเดือนละเท่าไร**
> ยืนยันได้ **1,325.83 THB (39.51 USD)** จากใบ Supabase 1 ใบ (2026-07-27) และ **ยังไม่จ่าย** · **monthly run-rate = NOT MEASURED** เพราะไม่มีใบรอบ ส.ค.–ต.ค. และเว็บ Production ถูกปิด (`402 DEPLOYMENT_DISABLED`) จึงไม่มี compute ที่เกิดขึ้นจริงให้วัดในปัจจุบัน

**2) ค่าใช้จ่ายพัฒนาแยกออกมาเท่าไร**
> แยกได้ในหมวด DEVELOPMENT (dedupe): **ส.ค. USD 1,457.09** (Anthropic 774.81 + RunPod 571.38 + OpenAI 110.90) **+ THB 653.27** (OpenAI) · **ก.ย. USD 334.00** (Anthropic 321 + GitHub 10 + OpenAI 3) · และมี **COST_UNALLOCATED** อีก USD 1,697.47 + THB 14,633.36 (ส.ค.) และ USD 451.51 + THB 6,464.00 (ก.ย.) ที่ยังแยกไม่ได้

**3) เครื่องใดกำลังประมวลผลเรื่องอะไร**
> - **Supabase Edge (Seoul)** 21 functions: รับ LINE webhook, จัดงาน AI, cron ด้านหนี้/ธนาคาร/ใบเสร็จ/ราคาน้ำมัน/สุขภาพระบบ — **ทำงานจริง**
> - **Supabase Postgres (Seoul)** 118 ตาราง — เก็บข้อมูลจริง 4,848 audit / 495 receipts / 43 invoices
> - **Vercel (sin1)** — **ปิดอยู่ (402)** ไม่ประมวลผลอะไร
> - **RunPod GPU 1 pod** — ใช้ครั้งสุดท้าย 2026-08-15 (104 runs, 2 วัน) สถานะปัจจุบัน **NOT VERIFIED**
> - **Mac ของเจ้าของ** — dev, storage scan (27 รอบ, 193 GB), AI coding 266 tasks
> - **Staging (Singapore)** — 0 functions ไม่ประมวลผล

**4) บัญชีทั้ง 3 มีสิทธิ์และใช้งานต่างกันอย่างไร**
> A (`acct_39cbd71c`) super_admin + org owner — สิทธิ์เต็ม มีกิจกรรมยืนยัน 2 audit + 1 AI task · B (`acct_2d06e2d6`) super_admin + org admin — สิทธิ์เต็มเท่ากัน แต่มีกิจกรรม AI coding 265 ครั้ง และ **0 audit** · C (`acct_8de1e3b9`) customer (บัญชีทดสอบ example.com) — เห็นเพียงหน้า `/user` แบบ static ไม่มี org ไม่มีข้อมูล ไม่มีกิจกรรม

**5) แต่ละบัญชีใช้ทรัพยากรและมีต้นทุนที่ตรวจสอบได้เท่าไร**
> **A: NOT MEASURED** (มี 2 write + 1 AI task แต่ไม่มี token/cost ที่ผูกบัญชี) · **B: NOT MEASURED** (265 AI tasks แต่ `worker_usage_events` ไม่มีคอลัมน์บัญชี และ `COST_LEDGER` ว่าง) · **C: 0** (ไม่มีกิจกรรมใดเลย) — ตัวเลขเดียวที่พิสูจน์ได้คือ "จำนวนครั้ง" ไม่ใช่ "จำนวนเงิน"

**6) ค่าใช้จ่ายส่วนใดยังไม่สามารถแยกตามบัญชีได้**
> เกือบทั้งหมด: Vercel (ทุกใบ), Supabase (ทุกใบ), Hostinger, Google/Apple, ค่าไฟ, Data transfer, AI inference 155 ครั้ง, connector 4,342 ครั้ง, เอกสาร 123 เวอร์ชัน, receipts 495 ใบ, storage 193 GB → คิดเป็น **>99.8% ของค่าใช้จ่ายที่ระบบดักได้**

**7) ต้องเพิ่มการวัดตรงจุดใดเพื่อให้คำนวณต้นทุนต่อบริการได้แม่นยำ**
> 6 จุดที่ให้ผลมากที่สุดตามลำดับ: (1) `engines/canonical/audit.ts:78` ต้องเขียน `actor_user_id` จริง (2) เพิ่ม `user_id/company_id/cost_usd` ใน `worker_usage_events` (3) ให้ `costGateRuntime#recordActualCost` เขียน `COST_LEDGER` ให้ครบทุก run (4) เก็บ CPU/RAM/GPU/Network ที่คอลัมน์มีอยู่แล้ว (5) เพิ่ม owner ใน `storage_resources` (6) เก็บ usage ของ Supabase/Vercel ผ่าน API ทุกวัน — ทั้ง 6 จุดนี้ทำให้ "ต้นทุนต่อบัญชี" จาก 0% กลายเป็น measurable

---

## §12 ข้อจำกัดของรายงานนี้ (อ่านก่อนใช้ตัวเลข)

1. **Snapshot เดียว** — แต่ละ GET ต่างเวลากันไม่กี่วินาที (2026-10-24T21:35Z – 22:06Z) และ `curl` runtime ตรวจ 2026-10-25 · ตัวเลขที่นับเพิ่มได้เอง (เช่น `audit_logs`) ขยับระหว่างการตรวจ: 4,847 → **4,848** แถวในรอบเดียวกัน — ใช้ตัวเลขชุด 4,848 เป็นค่าอ้างอิงของรายงานนี้
2. **ไม่มีสิทธิ์อ่าน usage/billing API ของ Supabase และ Vercel** → DB size, function invocation, storage bytes, plan tier = NOT MEASURED/NOT VERIFIED
3. **ไม่ได้ทดสอบด้วย session ของแต่ละบัญชี** (ไม่มีรหัสผ่าน และการปลอม JWT = ละเมิดข้อห้าม) → สิทธิ์รายบัญชีเป็น CONFIGURED + VERIFIED จาก policy/guard ไม่ใช่การยิง API จริง
4. **ไม่ได้อ่านเนื้อหาเอกสาร/สลิป** — ใช้ metadata เท่านั้น
5. **ไม่ได้ทดสอบข้ามองค์กรด้วยข้อมูลจริง** — ตรวจจาก policy + `org_members` + RLS deny เท่านั้น
6. **ตัวเลขใบเรียกเก็บเป็น email capture** ไม่ใช่ statement ผู้ให้บริการ → ใช้เป็น "หลักฐานว่ามีการเรียกเก็บ" ไม่ใช่ "ยอดที่จ่ายแล้ว"
7. **อัตราแลกเปลี่ยน 33.55 THB/USD** มาจากบันทึกของระบบเอง (1,325.83 ÷ 39.51, 2026-07-27) ไม่ใช่อัตราตลาด
8. **ไม่มีข้อมูลค่าไฟ** และไม่ควรประมาณขึ้นเอง

---

## ภาคผนวก — Evidence Index

| หลักฐาน | ที่อยู่ | ใช้ในหัวข้อ |
|---|---|---|
| Production aggregates | `reports/revenue-reverse-2026-10-25/production-census-2026-10-25.json` | §1, §4, §8 |
| Schema + บัญชี + bucket | `reports/revenue-reverse-2026-10-25/operating-cost-probe-2026-10-25.json` | §1, §4, §5, §7 |
| Attribution + invoice dedupe + telemetry | `reports/revenue-reverse-2026-10-25/account-cost-attribution-2026-10-25.json` | §5, §6, §7, §8, §9 |
| Runtime/host | `npx supabase projects list` · `functions list` · `migration list` · `curl -I https://dna-os-deadboard.vercel.app` | §1, §2 |
| RLS | anon HEAD 12 ตาราง → `*/0` | §5 |
| WAVE 4 เดิม (ไม่ใช้ตัวเลขโดยไม่ตรวจซ้ำ) | `reports/revenue-reverse-2026-10-25/WAVE4_*.md` | ทุกหัวข้อ |

**จบรายงาน — READ-ONLY เท่านั้น ไม่มีการแก้ระบบใด ๆ และหยุดหลังส่งรายงาน**

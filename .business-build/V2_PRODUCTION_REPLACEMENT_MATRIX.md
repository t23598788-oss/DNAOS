# V2_PRODUCTION_REPLACEMENT_MATRIX — DNA OS

> **รายงานเดียวสรุป V1 ↔ V2 replacement ก่อนขึ้น Production**
> BASE: `origin/main = c1d63dd` (release `0fe09b8` = app 0.2.0 + ⑤a-B freeze `c1d63dd`) · ยังไม่ commit (รอคำสั่ง)
> ทุกแถวตอบครบ 7 เรื่อง: ของเก่า · ของใหม่ · URL/entry เปลี่ยนไหม · data compatibility · authority ที่ถอด · regression · สถานะ

---

## 0. หลักการ (ห้ามคลาดเคลื่อน)

```text
Service เดิม + Domain เดิม + URL เดิม + Entry point เดิม
→ เปลี่ยน implementation ภายในเป็น V2 ทีละ capability
→ เวอร์ชัน = ของ application/service เดิม (package.json 0.2.x = V2 release)
→ ห้ามสร้าง dna-os-v2 · ห้ามสร้าง production domain ใหม่ · ห้ามทำระบบคู่ขนาน
```

```text
Production topology (คงไว้):
Domain เดิม → URL เดิม → Service เดิม → Application เดิม
   ├── capability ที่ V2 พิสูจน์แล้ว  → V2 implementation
   ├── capability ที่ยังไม่พร้อม     → V1 implementation เดิม
   └── UI                            → เปลี่ยนหน้าตาได้ แต่ URL/วิธีเข้าใช้ เดิม
```

### RULE #1 (release rule สำคัญสุด)

> **ห้ามถอด V1 capability จนกว่า V2 replacement ของ capability นั้นจะมีหลักฐานว่าเข้า URL เดิม ใช้ข้อมูลเดิม รักษาพฤติกรรมที่ต้องรักษา และผ่าน authority/regression/LIVE proof ที่เกี่ยวข้อง**

### สถานะ 3 ค่า (ต่อแถว)

| สถานะ | ความหมาย |
|---|---|
| **REPLACE** | V2 พิสูจน์ครบ → รับหน้าที่แทนของเก่า → ของเก่าจุดนั้น “ถอดได้” (เมื่อมี LIVE proof ตามคอลัมน์ Production) |
| **KEEP** | V2 ยังไม่มี replacement ที่พิสูจน์ครบ → ของเดิมอยู่ต่อ → **ห้ามถอด** |
| **BLOCK** | V2 เปลี่ยน contract/data/behavior แต่ยังพิสูจน์ compatibility ไม่ครบ (config/migration/session) → **ห้ามขึ้น Production จุดนั้น** |

หมายเหตุ: **ไม่ต้องรอ REPLACE 100% ทุกแถว** จึงจะ release — deploy ได้โดยแต่ละ capability อยู่ในสถานะของตัวเอง (per-capability cutover ใน service เดิม)

---

## 1. MATRIX

| # | Capability | V1 (ของเก่า) | V2 (ของใหม่) | URL/Entry | Data compatibility | Authority ที่ถอด | Regression (รันจริง) | สถานะ | Production |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Payment** | legacy หลายทาง (direct money writes + `reconcile_receipt_payment` ตรง) | `engines/canonical/payment-write.ts#confirmPayment` → PG RPC `confirm_payment_allocation` (commit เดียวใน DB) | **คงเดิม** (receipt confirm + gateway contract) | **คงเดิม** — tables/คอลัมน์เดิม (`invoices` paid/outstanding persisted, `payment_allocations`) | direct TS money writes (`direct_ts_writers=0`) + เส้นเงินที่ 2 (census authority canonical 1 / legacy 0) | payment-invariant **PASS T1–T14** · rpc-adapter **PASS authority=1** · preview-rewire exit0 (B-05 intact) · atomic **PROVEN_LOCAL** (dna_os_local · production untouched) · census exit0 | **REPLACE** | READY หลัง LIVE proof (DB-integration = NOT_EXECUTED env → ต้อง LIVE read ก่อน deploy) |
| 2 | **Payment allocation** | legacy allocation (`invoice_debts`/`documents` path) | canonical RPC `confirm_payment_allocation` (allocation+ledger+projection ใน TX เดียว · `20260923000001`) | **คงเดิม** | ตาราง allocation เดิม; legacy tables = **404 PGRST205 แล้ว** (อ่านผ่าน `invoice_payment_summary`) | allocation writes นอก RPC (rpc-adapter F4: no second write) | rpc-adapter **PASS F1–F8** · preview-rewire (persisted ไม่ใช้สูตร) | **REPLACE** | READY หลัง LIVE proof |
| 3 | **Debt PATCH** | เขียนยอดตรงได้ (`updateDebtTracking` → `total_outstanding`/`overdue_amount`) | **monetary FREEZE** — `422 DEBT_PATCH_MONETARY_FROZEN` + writer config-only (commit `c1d63dd`) | **คงเดิม** `PATCH /api/admin/debt-trackings/[id]` | **คงเดิม** — row/ตารางเดิม ไม่แตะ schema; ยอดแก้ผ่าน `/events` canonical | legacy monetary overwrite = **ถอดแล้ว** (`LEGACY_DEBT_PATCH_DIRECT_MONEY_OVERWRITE=0`) | debt-patch-freeze **17/17** · TSC 0 · pre-commit **All guards passed** · relationships-ui **64/64** · invariant T14 intact | **REPLACE ✓** | **READY** |
| 4 | **Debt CREATE** | `createDebtTracking` insert projection ตรง (ตั้งเงินต้น) | **ยังไม่ redesign** = `DEFERRED_DEBT_MODEL_DECISION` | **คงเดิม** `POST /api/admin/debt-trackings` | คงเดิม — create รูปเดิมเป๊ะ | ไม่มีการถอด (ยังเป็น V1) | freeze-test D1 (create คงรูป) + UI create ยังส่ง principalAmount | **KEEP** | KEEP (ห้าม redesign ก่อน Owner design round) |
| 5 | **Debt DELETE** | `deleteDebtTracking` hard delete | **ยังไม่ redesign** = `DEFERRED_DEBT_MODEL_DECISION` | **คงเดิม** `DELETE /api/admin/debt-trackings/[id]` | คงเดิม | ไม่มีการถอด (ยังเป็น V1) | freeze-test D2 (delete คงรูป) | **KEEP** | KEEP |
| 6 | **Documents** (PO/DO/INV/RCP/TaxINV/PV) | legacy source หลายจุด (builders/readers คนละทาง) | canonical `document-write` (create/issue/updateDraft/void) + `services/canonical` read + builders 6 หน้า | **คงเดิม** `/api/admin/documents` (+`[id]`, confirm) — ไม่มี endpoint ใหม่ | **parity**: `invoices`/`standalone_documents` + FK `customer_order_id` (แทน `transaction_id`) — legacy parts = 404 PGRST205 (live-checked) | legacy document create path (source-rewire: **no parallel builder**) | document-authority-census **58/58** · source-rewire **exit0 PASS** (live-checked) · document-lifecycle exit0 | **REPLACE** (ระดับ tests + live-checked selects) | **VERIFY** — ต้อง LIVE parity ใบจริงก่อน deploy |
| 7 | **Business Events** | direct writers ฝั่ง provider (4 insert + 13 update — phase-1 record) | `engines/canonical/event-write.ts` (create/enrich/transition) ผ่าน Next routes | **คงเดิม** (`build-event`, `send-debt`) | **คงเดิม** — `business_events` ตารางเดิม | provider direct event writes = **0 แล้ว** (invariant ถาวร) | census exit0 (`BUSINESS_EVENTS_WRITES=0`) · business-event-authority **34/34** (D5 ไม่แตะ money tables) | **REPLACE** | VERIFY (final census = pre-commit guard ทุก commit) |
| 8 | **LINE/Provider business writes (อีก 24 sites)** | Deno เขียน business table ตรง 24 sites (12 ตาราง) | canonical bridges ที่มีอยู่แล้ว (`connect-event`, `inbound-source`, `canonical-jobs`, `payment-confirm`) — pilot ใช้จริง (`event-followup` → canonicalTransport) | **คงเดิม** (webhook เดิม) | **คงเดิม** — ไม่ย้ายตาราง | **ยังไม่ถอดทั้งหมด** — เพดาน census: `DENO≤26` (ลดได้เพิ่มไม่ได้) · `NEXT≤3` · LINE monetary = 0 แล้ว | census exit0 (`deno 62 write sites · business 24 · monetary 2 · next 2`) | **KEEP** (ยังใช้ V1 บางส่วน by design) | KEEP + **ห้ามเพิ่ม** — ถอดเมื่อ P4/P6 เสร็จ (ก่อนหน้านั้นห้ามแตะ) |
| 9 | **Receipt inbound (upload/OCR → canonical)** | Deno insert `receipt_documents` ตรง (process-classified-image / payment-claim) | `engines/canonical/inbound-write.ts` (`INBOUND_MEDIA_REQUIRED`) ← `POST /api/admin/receipt-documents` + bridge `internal/connect/inbound-source` | **คงเดิม** | **คงเดิม + เพิ่ม** link/audit (`inbound_source_links`, media_path บังคับ) — คอลัมน์เดิม | direct `receipt_documents` insert นอก canonical (ฝั่ง Next = canonical แล้ว) | receipt-upload-ocr-e2e **L1 3/3** · relationships-ui **64/64** (feed `receipt.timeline-card`) | **REPLACE** (source) | **VERIFY** — L2/L3 LIVE proof = BLOCKED รอ Owner เปิด magic link 1 ครั้ง |
| 10 | **Identity** | legacy mapping inline ใน session (id-only + ad-hoc email fallback) | `core/identity/identity.ts` `resolveIdentityContext` (id → email → **แถวเดิม**) — sole reader ของ `user.identities`; session delegate | **ทางเข้าเดิม** (login→session chain ไม่เปลี่ยน) | **projection รองรับของเก่า** — `profiles` แถวเดิม; federation migration `20260927000001` = NOT APPLIED (มี fallback id→email ไม่บล็อกของเดิม) | identity resolution กระจัดกระจาย → **authority เดียว** (ไม่ใช่ money authority) | identity-layer **13/13** · connect-identity-model **54/54** · auth-single-flow **14/14** · auth-access **23/23** | **REPLACE** (source-level) | **VERIFY LIVE** (TRACE Gate4 + apply federation migration) |
| 11 | **Auth** | password-primary + env auto-login (หลายจุด) | single auth flow — email OTP + provider buttons + **`/auth/confirm` verifier เดียว** (`/auth/verify` = forward) · password = maintenance · auto-login = 410 | **`/login`, `/auth/confirm` URL เดิม** (`/auth/verify` = alias ที่**เพิ่ม** ให้ template ไม่ 404 — ทางเข้าเดิมไม่หาย) | **session/user เดิม** (`auth.users` Supabase ไม่เปลี่ยน) | second identity method (env-password path) = **ถอดแล้ว** (zero-caller audit) | auth-single-flow **14** · auth-access **23** · login-autofill **12** · identity-layer **13** · SSR probes (release round) | **REPLACE** (source) | **VERIFY** (LIVE session proof) — ย่อย OAuth = BLOCK ข้อ 12 |
| 12 | **OAuth providers (Google/Apple/Azure)** | ไม่เคย live (ปุ่มมาพร้อม 0.2.0) | `signInWithOAuth` tier บน `/login` เดิม | **คงเดิม** `/login` | identities ผ่าน `user.identities` (rows เดิม) | n/a (auth authority = Supabase auth เดิม) | source tests ผ่าน (ปุ่ม/flow shape) · **LIVE probe = `400 provider is not enabled`** | **BLOCK** | **BLOCKED — config** (provider toggles + redirect URLs + Google Console callback) — ไม่ใช่ code failure, ห้ามแก้ด้วย auth flow ใหม่ |
| 13 | **Provider credentials + Devices meta** | ไม่มี (ของใหม่ทั้งคู่) | provider-settings board + device registry/scope (`core/policy/scope`, device pair RPC) | **คงเดิม** `/admin/settings`, `/admin/devices` | ตารางใหม่ (`provider_credential_*`, `device_*`, `scoped_grants`, `device_commands`) **ยังไม่มีบน LIVE** — รอ migration | credential vault: connectors เดิมยังใช้ `connector-loader` no-env-fallback (คงเดิม) | provider-credentials **52/52** · device-connector **34/34** · tool-scope **32/32** (source) | **BLOCK** | **BLOCKED — migration** `20260924000001` `20260925000001` `20260926000001` NOT APPLIED (runtime ตอบ `409 META_TABLES_MISSING`) |
| 14 | **UI (Workspace core + admin pages)** | UI ปัจจุบัน (pages เดิม) | `BusinessWorkspace` + `InboxIndicator` + toolBindings + relationships workspace **dual-UI** (`?ui=legacy` = rollback) | **URL เดิมทุกหน้า** (ไม่มี route ใหม่; template/preview shells มีป้าย “ต้นแบบ” ไม่ใช่ production entry) | **API contract เดิม** — fetch endpoints เดิม (`relationships`, `finance-alerts`, `outbound-drafts`, …) | ไม่มี (UI ไม่ถือ authority) — layout **cannot grant access** (พิสูจน์ใน test) | workspace-tool-bindings **PASS** · relationships-ui **64/64** · pwa-install **18/18** | **REPLACE (workspace core)** / **KEEP (หน้า admin ที่ยังไม่ย้าย — URL เดิมคงเดิม)** | PARTIAL |

---

## 2. หลักฐาน regression รวม (รันจริง ณ BASE `c1d63dd`)

| กลุ่ม | ผล |
|---|---|
| `debt-patch-freeze` (negative control) | **17/17 PASS** · `LEGACY_DEBT_PATCH_DIRECT_MONEY_OVERWRITE = 0` |
| `tsc --noEmit` | **0 errors** |
| pre-commit เต็ม (14 guards + Registry Integrity + Guard8b census) | **exit0 · “All guards passed”** (ทั้ง dry-run และตอน commit `c1d63dd`) |
| payment authority | invariant **PASS T1–T14 + direct_ts_writers=0** · rpc-adapter **PASS (authority=1)** · preview-rewire exit0 · atomic **PROVEN_LOCAL** (production untouched) |
| connect-boundary census | **exit0** — `payment authority canonical 1 + legacy 0` · `business_events direct=0` · `deno 24/26 · next 2/3 · LINE monetary 0` |
| documents | authority-census **58/58 (exit0)** · source-rewire **exit0** · lifecycle exit0 |
| identity/auth | identity-layer **13** · connect-identity **54/54 (exit0)** · single-flow **14** · auth-access **23** · autofill **12** |
| events/UI/receipt | business-event-authority **34/34** · relationships-ui **64/64** · tool-bindings **exit0** · pwa **18** · receipt L1 **3/3** |
| devices/connect | provider-credentials **52** · device-connector **34** · tool-scope **32** |
| **env-blocked (NOT claimed)** | `canonical-phase-c/d` = อ่าน `/tmp/phaseC-before.json` (snapshot ตาม runbook §C1 + service-role — test source = identical HEAD) · canonical-finance-acceptance = DB-gated · receipt L2/L3 = รอ Owner session |

## 3. BLOCKED LIST — ห้ามขึ้น Production จุดนั้น จนกว่าจะปลด

1. **OAuth providers** (แถว 12) = config — provider toggles + redirect URLs + Google Console callback → Owner gate ①
2. **Provider credentials + Devices** (แถว 13) = apply migrations `20260924000001 / 20260925000001 / 20260926000001` (+ `20260927000001` soft + ใบที่ 5 ตามบันทึก) → Owner gate ②
3. **Receipt L2/L3 · Identity TRACE · Auth LIVE** = Owner เปิด magic link 1 ครั้ง → Owner gate ④
4. **Documents LIVE parity + Payment LIVE read** = proof ระดับ DB จริงก่อน deploy

## 4. บันทึก DEFERRED (จงใจไม่ทำในรอบนี้)

- **Debt CREATE / Debt DELETE** = `DEFERRED_DEBT_MODEL_DECISION` — ยึด V1 ห้าม redesign (บันทึกใน comment ของ route + writer และ freeze-test D1/D2)
- **LINE 24 direct sites** (แถว 8) = รอ P4/P6 — KEEP ห้ามเพิ่ม ห้ามถอดพร่ำเพรื่อ
- ไม่มี service/โดเมน/ระบบคู่ขนานใหม่ใด ๆ — เวอร์ชันคือ `package.json 0.2.x` ของ app เดิม; รายงานนี้ = เอกสารเดียวสำหรับการตัดสินใจก่อน Production

---

## 5. GATE DECISION LOGIC (อ่านก่อน deploy — ผลต้องเป็นแบบเครื่องจักร)

ต่อแถวใน §1 อ่าน “สถานะ” + “Production” แล้วสรุปคำสั่งได้แม่นยำ 4 กรณี:

```text
REPLACE + required LIVE proof PASS → ใช้ V2 (ถอดของเก่าจุดนั้นได้)
KEEP                               → รักษา implementation เดิม (ห้ามถอด)
BLOCK                              → ห้าม cutover จุดนั้น
PARTIAL                            → เปลี่ยนเฉพาะส่วนที่ระบุว่าพร้อม
```

**เงื่อนไข LIVE proof รายแถว (ต้อง PASS ก่อนนับ REPLACE → ใช้ V2):**

| แถว | LIVE proof ที่ต้องการ |
|---|---|
| Payment · Payment allocation | LIVE read ยอดจริงจาก DB |
| Documents | LIVE parity ใบจริง |
| Receipt inbound | L2/L3 e2e (Owner เปิด magic link 1 ครั้ง) |
| Identity | TRACE Gate4 + apply federation migration |
| Auth (+ย่อย OAuth) | LIVE session proof · OAuth = gate ① (คง BLOCK จนปลด) |

**กฎการอัปเดต:** ทุกครั้งที่ Owner gate (① config / ② migrations / ④ session) ผ่าน → เปลี่ยน**เฉพาะคอลัมน์สถานะ/Production ของแถวนั้น พร้อมวางหลักฐานจริง**ในไฟล์นี้ไฟล์เดียว — รอบอัปเดตสถานะห้ามแก้ source

หลักคงเดิม: **Domain เดิม → URL เดิม → Service เดิม → Application เดิม** — V2 = อัปเกรดก้อนเดิม ไม่ใช่สร้างระบบแข่งกับของเดิม
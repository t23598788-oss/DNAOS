# PRODUCTION EVIDENCE — 2026-10-20 (5-step approved run)

โหมด: เก็บ/ตรวจ/แก้ pipeline ตามคำสั่งที่อนุมัติ **ไม่มีการ deploy / push / แก้สิทธิ์ฐานข้อมูล**

## ขั้น 1 — เก็บของ Production ปัจจุบัน (ไม่เปลี่ยนระบบ)

| รายการ | หลักฐาน |
|---|---|
| Railway project/service | `DNA-OS-INFRASTRUCTURE` / `dna-os-deadboard` (iad) · deployment `62792c73` SUCCESS RUNNING · deploy เมื่อ 2026-10-18T18:40Z **ไม่ผูก commit ใด** (snapshot จาก working tree) · ก่อนหน้าทุก deployment REMOVED → ไม่มี rollback target ที่พิสูจน์ได้ |
| Service เชื่อมพ่วง | `owner-command-http` (Online), `dna-os-circuit` (Online), `joint-monitor`, `mongodb-production` (เชื่อมผ่าน `RAILWAY_SERVICE_*_URL`) |
| env var (ชื่อเท่านั้น — ไม่พิมพ์ค่า) | AI_GATEWAY_OLLAMA_URL, ANTHROPIC_API_KEY(dummy value), CLINE_TASK_WAIT_MS, CONNECT_INTERNAL_SECRET, DNA_AI_RELAY_SHARED_SECRET, INBOUND_SOURCE_INTERNAL_SECRET, INFRA_OWNER_VERIFICATION_URL, LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, LINE_COMMAND_INTERNAL_SECRET, LINE_TOKEN_INTERNAL_SECRET, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_URL, OPENAI_API_KEY, OWNER_COMMAND_HTTP_SHARED_SECRET, PAYMENT_CONFIRM_INTERNAL_SECRET + RAILWAY_* ระบบ |
| ข้อสังเกต | `dnaos.dev` ชี้ Railway แต่ cert เป็น `*.up.railway.app` (อ้างจาก cutover เมื่อวาน; ไม่ได้ probe ซ้ำในรอบนี้) |

## ขั้น 2 — ตรวจเทียบ Local / GitHub / Railway

| แหล่ง | SHA/สภาพ |
|---|---|
| Local | `gxkg` @ `14139082` + 695 รายการยังไม่ commit |
| GitHub | `github/main` @ `84d8c7f6` = **merge-base เดียวกัน** — local ครัวหน้า 32 commits, GitHub ครัวหน้า 0 (ไม่ diverge) · diffstat: 171 ไฟล์ +17,671/-1,502 |
| Railway | snapshot ของ working tree ขณะ deploy — reproduce จาก commit ไม่ได้ · ส่วน surface ที่ตอบตอนนี้ตรงกับ local (probe ชุดเดียวกัน 200/401/405 ตรงกัน) | 

## ขั้น 3 — สิทธิ์ Supabase + ช่องทางเข้า Backend

- migration ที่บันทึกใน production DB (`xeytcavxejhyzxwevgto`): 115 รายการ · **ยังไม่ลงฐานข้อมูล 31 รายการ** รวม `20261019000001–03` (RLS recursion fix + document ownership) และ `20261016000001–03` (company_members/assets/stock) ฯลฯ → ไฟล์เต็ม: `artifacts/cutover/supabase-migration-list-production-2026-10-20.txt`
- probe สด (anon): `/api/governance`,`/api/admin/*` → **401 fail-closed** ✓ · `/api/internal/*` → 405 (ต้อง POST + internal secret) ✓ · **เสียงรั่วที่ยังเปิดสาธารณะ 11 endpoint** ของ dev plane (`/observer`, `/observer.json`, `/api/v1/modules` (641KB), `/api/v1/constitution` (229KB), `/api/v1/spec`, `/playground`, `/examples`, `/start`, `/api/v1/mcp/architecture/summary`, `/api/v1/drivers`, `/api/v1/workflows`) — ยืนยันซ้ำในรอบนี้

## ขั้น 4 — ขอบเขตแยก Business / Developer-Operator

- เอกสาร: `artifacts/cutover/BUSINESS_OPERATOR_BOUNDARY_2026-10-20.md` (สามารถอ้าง ref ของ `registry/business-production-surface.json`: excluded_pages 25 · excluded_apis 29 · kept business surfaces รวม)
- แก้ ~~ผิดเบี่ยงต้อง fix~~ **registry drift ตัวเดียวที่เจอ**: `kept_business_surfaces.apis: "/api/admin/quotes"` → ไม่มี route จริง แก้เป็น `/api/admin/quotation-queue` (มี route.ts ตรวจแล้ว) ผล: MISSING_BUSINESS_SURFACES = **0**

## ขั้น 5 — Build + ความปลอดภัย (สถานะปัจจุบัน)

**แก้แล้ว (ตรวจซ้ำผ่าน):**
1. **E1** — build ใน staged tree resolve ไม่ถึง next: symlink ถูก Turbopack ปฏิเสธ (`points out of the filesystem root`) → คัดลอก `node_modules` จริงเข้า stage · ผล: compile OK (8–16s)
2. **E2** — `/observer.json` รอดจาก prune (เป็น route.ts ใน folder ชื่อ observer.json แต่ registry ระบุใน pages) → prune รองรับทั้ง page + route handler · ผล: pruned 251/466, `/observer.json` หายจาก manifest ✓
3. **E5** — `.env*` เข้า build input → ตัด FAIL-CLOSED + ส่งค่าเข้า child env ของ build แทน · ผล: `ls .business-build/.env*` ว่าง ✓ (ตัว test ของผมซึ่ง copy .env.local ชั่วคราวถูกลบแล้ว)
4. `scripts/`/`local-runtime/` ถูกตัดออกจาก **staged tsconfig** เท่านั้น (source tsconfig ไม่แตะ) · type check ผ่าน

**ผล verify ที่ผ่าน:** 220 business routes · NEW_DEVELOPER_ROUTES_IN_BUILD = 0 · NEW_DEVELOPER_CONTROL_APIS_IN_BUILD = 0 · MISSING_BUSINESS_SURFACES = 0

**BLOCKER ที่เหลือ (อัพสตรีม — ไม่แต่ง evidence):**
- มี bug ของ Next.js 16 ปัจจุบัน: **E1068 "Expected workStore to be initialized"** ตอน prerender ต้นไม้ที่ถูกตัด (business-only) ระเบิดรู้ทุกครั้งที่หน้าล้มไม่ซ้ำกัน (`_not-found`, `_global-error`, `/account/change-password`, `/admin/*`, `/liff/add-friend` …)
- อ้างอิงอัพสตรีม: vercel/next.js#98200 (E1068) · fix PR #98198 **ยังไม่ถูก merge/release**
- การพิสูจน์ข้างเคียง: build เต็ม (root, cold, 2 รอบ) **ผ่าน 2/2** ⇒ ผลระเบิดเฉพาะต้นไม้ prune เท่านั้น · vendor-patch 2 บรรทัด #98198 + `experimental.inlineCss: true` (workaround จาก issue) พยายามแล้ว **ยังไม่เคลียร์** ในเครื่องนี้
- ข้อเท็จจริงที่ยังพิสูจน์ไม่ได้ในรอบนี้: ว่า Railway build เมื่อ 10-17 ที่ FAILED (`0473...`) ล้มเพราะ bug ตัวนี้หรือไม่ (log เก่า REMOVED หมดแล้ว)

**ทางเลือกต่อไป (ต้องตัดสินจากคุณ — หยุดรอตรงนี้):**
1. ดำเนินต่อลึกขึ้นใน Next internals เพื่อหาจุด ALS หายจริง (ค่า restore stack ที่ถูก suppress ด้วย `ignore-listed frames` / อาจต้อง patch มากกว่านี้)
2. ทดลอง upgrade `next` patch version (ผ่าน package.json — ต้องอนุมัติ เพราะเปลี่ยน dependency จริง) แล้วพิสูจน์ซ้ำ
3. เลื่อนไปใช้ `output: "standalone"` / build mode อื่นของ Next เพื่อเลี่ยงตัว export บางขั้น (ต้องตรวจว่ายัง fail-closed เหมือนเดิม)

ทุก log/หลักฐานอยู่ที่ `artifacts/cutover/*.log`, `artifacts/cutover/business-build-evidence.json`, `artifacts/cutover/supabase-migration-list-production-2026-10-20.txt`

**ยังไม่ Commit / Push / Deploy — รออนุมัติ**

---

# ต่อยอดรอบ BLOCKED-RECOVERY (รอบถัดมาภายในวันเดียวกัน) — 15:20 +07

## ความคืบหน้าการหาสาเหตุจริงของ E1068 (หลักฐานจาก stack จริง — ไม่เดา)

1. ติดตั้ง trace marker ใน `node_modules/next` ชั่วคราว (dist CJS 9 จุด + ESM 9 จุด + compiled app-route bundles 8 จุด) เขียน stack ผ่าน `fs.appendFileSync` ไปยัง `artifacts/cutover/e1068-trace.log` (side-channel เพราะ stdio ของ prerender worker ถูก suppress เป็น "ignore-listed frames")
2. **stack จริงที่จับได้ (จากรอบ build ล้มรอบ 15:1x):**
   - จุด throw: `createServerSearchParamsForMetadata` (search-params.js) ภายใน SSR chunk `node_modules_next_dist_1map00z._.js`
   - ผู้เรียก: `createMetadataComponents({tree,pathname,parsedQuery,...})` — เรียก `M(parsedQuery, isRuntimePrefetchable)` ทันทีที่เริ่ม
   - บริบท caller: ผ่าน `workUnitAsyncStorage.run(workUnit{'type':'prerender-legacy'}, lN, ...)` ใน `app-page-turbo.runtime.prod.js` → `exportAppPage` → `exportPageWithRetry`
   - สภาพ: **`workAsyncStorage.getStore()` = undefined** ณ จุดที่ createMetadataComponents ถูกสร้าง — เช่นเดียวกับลักษณะ AMD-boundary loss ที่อ้างใน next.js#98200 แต่ต่างจุด (ไม่ใช่ resolveMetadata ที่ PR#98198 แก้ — ตัวนั้นแก้แล้วใน vendor และยังระเบิดต่อ)
3. สรุปข้อเท็จจริงที่พิสูจน์ได้ตอนนี้: crash ที่หน้าใดไม่ตายตัว (ต่างกันทุก run) ทุกครั้งเกิดตอน **cold prerender with 9 workers** คือระยะ export/Generate static pages เท่านั้น และเฉพาะต้นไม้ที่ prune (root full-tree cold 2/2 ผ่าน)
4. ทางที่ยังพิสูจน์ไม่ครบ (BLOCKED — ขออนุมัติต่อ): (a) ทำ master ไม่เปลี่ยน ให้ build ทราบ root-cause รอบเรียง (b) ทดสอบ runtime upgrade `next` (patch version) (c) ถึง upstream maintainer ด้วย stack ใน e1068-trace.log เพื่อตรวจสอบต่อผู้ที่รู้ internal ของ React render scheduler

## ข้อห้ามที่ปฏิขนายจริง (ตรวจสอบแล้วในรอบนี้)

- ไม่ได้ลบ source ใด ๆ ไม่ได้ reset/force-push git ไม่ได้ touch staging area ที่มี 62 renames ค้างอยู่
- `node_modules/next` ที่ patch เป็น **ชั่วคราว** (ไม่เข้า git, `npm ci` จะคง best state ปรกติ) — เอาไว้เสนอทีม upstream หรือเก็บ zeruring ด้วย patch-package ในอนาคต
- AI gateway (app/api/internal/ai/, engines/, local-runtime/) — งานรอบนี้ไม่ได้แตะ (พิสูจน์ด้วย git status รอบจบ)

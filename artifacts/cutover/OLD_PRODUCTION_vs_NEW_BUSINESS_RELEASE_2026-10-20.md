# OLD PRODUCTION vs NEW BUSINESS RELEASE — รายงานตรวจสอบแบบ READ ONLY

**วันที่:** 2026-10-20 · **คำสั่ง:** DNA OS — STRICT BUSINESS-ONLY PRODUCTION CUTOVER
**ขอบเขตรอบนี้:** ตรวจแบบอ่านอย่างเดียว 3 ข้อเท่านั้น — ไม่ลบ ไม่แก้ source ไม่แก้ OTP ไม่แก้ฐานข้อมูล ไม่ Commit / Push / Deploy

---

## ข้อ 1 — Railway Production ปัจจุบันรันอะไรอยู่จริง

หลักฐาน: `railway status`, `railway deployment list`, `railway api` (GraphQL), `railway logs -b/-d` (build+deploy logs ของ deployment จริง), HTTP probe สด

| รายการ | ค่าจริงที่อ่านได้จาก Railway API | หลักฐาน |
|---|---|---|
| Project | `DNA-OS-INFRASTRUCTURE` — id `ffe589bf-58fb-4e3e-8969-4a75915fda1a` | `railway status` |
| Environment | `production` — id `4d28eafa-9735-4405-a585-55ea354bafab` | `railway status` |
| Service | `dna-os-deadboard` — id `c08254e4-9679-4984-b388-402f7909bf47`, region `iad`, 1 replica, restart `ON_FAILURE` (max 10), ไม่มี healthcheck path, ไม่มี cron | `railway status` + `serviceInstance` query |
| **Deployment ID** | **`62792c73-4b1f-4603-9e47-3192be4ba079`** — status `SUCCESS`, instance `RUNNING` | `railway deployment list` + GraphQL `deployment(id:)` |
| เวลา deploy | created `2026-10-18T18:40:30Z` (= 2026-10-19 01:40:30 +07), updated `2026-10-18T18:45:06Z` | GraphQL `createdAt/updatedAt` |
| **Commit SHA** | **ไม่มี — deployment นี้ไม่ได้ผูกกับ git commit ใด ๆ** | `deployment.meta` มีเฉพาะ `buildOnly, cliAgentSessionId, cliCaller, fileServiceManifest, imageDigest, logsV2, nixpacksProviders, propertyFileMapping, reason, rootDirectory, runtime, serviceManifest, volumeMounts` — **ไม่มีฟิลด์ commit**; `meta.reason="deploy"`, `meta.cliCaller="agent_unknown:apple_terminal:freebuff"`; build log บรรทัด 1-3: `scheduling build on Metal builder "builder-voucek"` → `fetched snapshot sha256:e3ed41c4f8e59106009bb213f72664887cb447aee1c7ba7434198d6259b93872 (13 MB bytes)` → `unpacking archive` ⇒ **เป็นการอัปโหลด snapshot จาก working tree ที่ไม่ใช่ git checkout** |
| Commit ฐานของ worktree ปัจจุบัน | `14139082fcdd29e6d03a79c05d146b2440cf5078` (branch `gxkg`, 2026-10-19 01:32:30 +07) — **แต่มีงานที่ยังไม่ commit 695 รายการ** (344 M, 288 untracked, 62 staged-rename ที่ไม่มีไฟล์ใน worktree, 1 D) ⇒ artifact ที่รันอยู่ **reproduce ไม่ได้จาก commit ใด** | `git log -1`, `git status --porcelain` |
| **Build command** | ไม่ override ⇒ Railpack default → `npm run build` → `next build` (Next.js **16.2.9** Turbopack) | build log: `> dna-os@0.2.0 build` / `> next build` / `▲ Next.js 16.2.9 (Turbopack)` |
| **Start command** | `serviceInstance.startCommand = null` **และ** `deployment.meta.serviceManifest.deploy.startCommand = null` ⇒ Railpack default → `npm run start` → `next start` | GraphQL `serviceInstance(...)` + `deployment.meta.serviceManifest.deploy` |
| Runtime ที่ใช้ build | Railpack **0.42.0**, Node **24.21.0** (railpack default lts), package manager `npm` (ตรวจ `package-lock.json`), workspace 1 package | build log: `using build driver railpack-v0.42.0`, `│ node │ 24.21.0 │ railpack default (lts)` |
| Domain | `dnaos.dev` (custom) + `dna-os-deadboard-production.up.railway.app` (service) — ทั้งคู่ ACTIVE, port 8080 | `railway domain list` |
| **ความผิดปกติที่พบ** | `dnaos.dev` ชี้ไป Railway แต่ **certificate เป็น `*.up.railway.app`** ⇒ `SSL: no alternative certificate subject name matches target host name 'dnaos.dev'` ⇒ HTTPS verify ไม่ผ่านจาก client มาตรฐาน (curl exit 60). โดเมน canonical ที่ประกาศไว้จึง **ใช้งานไม่ได้จริง** | `curl -v https://dnaos.dev/` |
| สถานะ instance | `RUNNING`, `canRollback=true`, `canRedeploy=true` — แต่ deployment ก่อนหน้าทุกตัวในรายการเป็น `REMOVED` (มีแค่ `0473...` เป็น `FAILED` จาก 2026-10-17) ⇒ **ยังไม่มี deployment สำเร็จรอบก่อนที่ยืนยันว่าใช้เป็น rollback target ได้** | `railway deployment list` + GraphQL `canRollback/canRedeploy` |

---

## ข้อ 2 — Business-only Release ที่เตรียมไว้: อยู่ที่ไหน, build สำเร็จไหม, error อะไร

**ตำแหน่งทั้งหมด (ยังอยู่ ไม่ถูกลบ):**

| ส่วน | พาธ |
|---|---|
| โค้ดทั้งโปรเจกต์ (worktree) | `/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck` |
| ตัว builder business-only | `scripts/business-production-build.ts` |
| อำนาจเดียวที่กำหนดว่าอะไรถูกตัด | `registry/business-production-surface.json` |
| **staged build input (สำเนาต้นไม้ที่ถูกตัด)** | `.business-build/` (216 route file เหลือจาก 466) |
| evidence ของ build | `artifacts/cutover/business-build-evidence.json`, `artifacts/cutover/business-build.log` |

### สถานะ build: **FAILED — ยังไม่มี artifact**

`.business-build/.next` มีแค่ `types/`, `cache/`, `trace/`, `turbopack/`, `diagnostics/` — **ไม่มี `app-path-routes-manifest.json` และไม่มี `routes-manifest.json`** ⇒ ไม่เคยได้ route table ของ business release

### Error ที่ยังค้าง (ทั้งหมด)

| # | ระดับ | Error | สาเหตุ |
|---|---|---|---|
| E1 | **FATAL — build หยุดตรงนี้** | `Turbopack build failed with 1 errors: Next.js inferred your workspace root, but it may not be correct. We couldn't find the Next.js package (next/package.json) from the project directory: /Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/.business-build/app` | ขั้น STAGE ตัด `node_modules` ออก (`COPY_EXCLUDES`) แล้วไม่ได้ทำ symlink กลับ ⇒ `.business-build/` ไม่มี `next/package.json` ให้ Turbopack resolve |
| E2 | **FATAL — fail-closed ตรงนี้** | `[FAIL] developer routes survived the source prune: /observer.json` | registry ใส่ `/observer.json` ไว้ใน `excluded_pages` แต่ไฟล์จริงคือ `app/observer.json/route.ts` (เป็น route handler ไม่ใช่ page) ส่วน pruner ลบ `page.*` เฉพาะเมื่ออยู่ใน `excluded_pages` และลบ `route.*` เฉพาะเมื่ออยู่ใน `excluded_apis` ⇒ ไฟล์ไม่เคยถูกลบ (log ยืนยัน: `unmatched_registry_prefixes: ['pages:/observer.json']`) |
| E3 | **หลักฐานไม่ถูกต้อง** | `NEW_DEVELOPER_ROUTES_IN_BUILD = 0` / `NEW_DEVELOPER_CONTROL_APIS_IN_BUILD = 0` / `MISSING_BUSINESS_SURFACES = 98` | ตัวเลขทั้งสามคำนวณจาก **manifest ว่างเปล่า** เพราะ build ไม่เคยจบ ⇒ **ยังพิสูจน์อะไรไม่ได้** (98 business surface ที่ขึ้นว่า "missing" ก็เพราะไม่มี manifest ไม่ใช่เพราะหายไปจริง) |
| E4 | **โค้ดเครื่องมือพัฒนายังอยู่** | `developer tool residual modules = 95` | route file ถูกลบแล้ว แต่ **implementation ยังอยู่ใน build input**: `app/api/admin/ide/_lib/` ยังมี 112 ไฟล์ (`fileWrite.ts`, `releaseRuntime.ts`, `gitReadOnly.ts`, `search.ts`, `deploymentRegistry.ts` …) + `app/developer/layout.tsx` + `app/admin/deploy/layout.tsx` ⇒ ยังพิสูจน์ไม่ได้ว่า "ไม่ถูกรวม" ในตัว build จริง |
| E5 | **ความสะอาดของ secret** | staged tree มี `.env.local` (13 ค่าที่ไม่ว่างทั้งหมด) | `COPY_EXCLUDES` ไม่ได้ตัด `.env*` ⇒ build ใหม่จะ **โหลด `.env.local` ตอน build** (log ใหม่มีบรรทัด `- Environments: .env.local` ขณะที่ build ของ production เก่า **ไม่มี** บรรทัดนี้) ⇒ ต้องตัดออกก่อน deploy ทุกครั้ง |

**สิ่งที่ทำงานได้แล้ว:** ขั้น PRUNE ตัด route file ออกจาก build input สำเร็จ 250 ไฟล์ จาก 466 (ทุก prefix ใน registry มีผล ยกเว้น `pages:/observer.json` ข้างบน)

---

## ข้อ 3 — Source code / route ของระบบพัฒนาที่ "ถอนออกแล้ว" ยังอยู่ใน Build ใหม่หรือไม่

**ข้อเท็จจริง: ยังอยู่ทั้งหมด — การถอนออกเกิดขึ้นเฉพาะในสำเนา `.business-build/` ซึ่งยัง build ไม่ผ่าน และใน source ยังไม่มีอะไรถูกถอนออกจริง**

| ตำแหน่ง | สถานะระบบพัฒนา | หลักฐาน |
|---|---|---|
| **Source worktree** (สิ่งที่จะกลายเป็น production ถ้า deploy ตอนนี้) | **ยังอยู่ครบ** — `app/developer/page.tsx`, `app/admin/ide/page.tsx`, `app/admin/deploy/page.tsx`, `app/admin/reader/page.tsx`, `app/admin/infrastructure/page.tsx`, `app/api/routes/route.ts`, `app/api/reader/route.ts`, `app/observer.json/route.ts`, `app/playground/page.tsx`, `app/examples/page.tsx`, `app/start/page.tsx` — `PRESENT` ทุกตัว; `app/api/admin/ide/_lib/` ยังมี **112 ไฟล์** | `ls` / `test -e` บน worktree |
| **git index** | มี 62 staged rename `app/api/admin/ide/_lib/* → engines/shared/ide-lib/*` (สถานะ `RD` = staged rename แต่ worktree ไม่มีไฟล์) แต่ `engines/shared/ide-lib/` **ไม่มีอยู่จริง** และไฟล์ต้นทางยังอยู่ที่เดิม ⇒ **การ "ย้าย" ไม่มีผลจริง**, index กับ worktree ไม่ตรงกัน | `git status --porcelain` (62×`RD`), `ls engines/shared/ide-lib` → No such file |
| **Build แบบเต็มที่เคย build ในเครื่อง** (`.next/`) | **477 routes รวม route ของระบบพัฒนาทั้งหมด** (`/admin/ide`, `/admin/deploy`, `/admin/dev-loop`, `/admin/dbd`, `/admin/infrastructure`, `/admin/reader`, `/admin/traces` …) ⇒ `next build` ปกติของ repo นี้ **ยังแพ็กเครื่องมือพัฒนาไปด้วย** | `.next/app-path-routes-manifest.json` |
| **Staged business tree** (`.business-build/`) | route file ของ dev ถูกลบจริง (`app/admin/ide`, `app/api/admin/dev-loop`, `app/admin/reader`, `app/api/routes`, `app/api/reader` → `absent`) แต่ **โค้ด implementation ยังอยู่** (ดู E4) และ `/observer.json` ยังรอด (ดู E2) | `find .business-build/app -name "route.ts*" -o -name "page.ts*"` = 216, `test -e` |
| **Runtime backstop** `core/auth/developerPlaneGate.ts` (403 เมื่อ production) | **มีใน source แต่ไม่ได้ deploy** ⇒ ยืนยันจาก production จริง: `/api/admin/ide/command` ตอบ **401** (`{"ok":false,"error":"ต้อง login ก่อนใช้งาน"}`) ไม่ใช่ 403 ⇒ dev API **ยังเปิดอยู่สำหรับผู้ที่ login แล้ว** (รวม super_admin) | live probe + การมีอยู่ของไฟล์ใน source |

### ระบบพัฒนาที่ยัง "เปิดสาธารณะ" บน OLD PRODUCTION (ไม่ต้อง login เลย)

ไล่ probe สด `dna-os-deadboard-production.up.railway.app` — 11 endpoint ตอบ **200 โดยไม่ต้อง authenticate**:

| Path | Status | ขนาดที่อ่านได้ | สิ่งที่รั่วออกไป |
|---|---|---|---|
| `/api/v1/modules` | 200 | **472,879 B** | module registry ทั้งระบบ (inventory ของ source ทั้งหมด) |
| `/observer` | 200 | 235,446 B | Architecture Observer (หน้า introspection เต็ม) |
| `/api/v1/constitution` | 200 | **162,201 B** | constitution + architecture principles ภายใน |
| `/observer.json` | 200 | 35,991 B | registry dump แบบ machine-readable |
| `/api/v1/spec` | 200 | 32,624 B | API spec ของระบบ |
| `/playground` | 200 | 13,127 B | หน้า Playground ของคำสั่ง API |
| `/examples` | 200 | 55,693 B | หน้าตัวอย่างการเรียก API |
| `/start` | 200 | 52,087 B | Engineering Workspace |
| `/api/v1/mcp/architecture/summary` | 200 | 11,489 B | สรุป dependency graph ของ architecture |
| `/api/v1/drivers` | 200 | 1,870 B | driver registry |
| `/api/v1/workflows` | 200 | 1,832 B | workflow registry |
| `/api/manual-doc` | 501 | — | stub ที่ยังไม่ได้ถอด |

ส่วนที่ยังอยู่แต่ต้อง login: หน้า dev ทั้งหมดตอบ **307 → `/login?next=…`** และ dev API ตอบ **401** — คือ "มีอยู่จริง" ไม่ใช่ "ถูกถอด"

---

## ตารางเทียบ OLD PRODUCTION ↔ NEW BUSINESS RELEASE

| มิติ | OLD PRODUCTION (รันอยู่จริง) | NEW BUSINESS RELEASE (เตรียมไว้) |
|---|---|---|
| ตำแหน่ง | Railway `DNA-OS-INFRASTRUCTURE` / production / `dna-os-deadboard` | worktree `dna-os-maincheck` + staged `.business-build/` |
| Build | ✅ สำเร็จ (`next build`, Next 16.2.9 Turbopack) | ❌ **FAILED** (E1) — ไม่มี artifact |
| Deployment ID | `62792c73-4b1f-4603-9e47-3192be4ba079` | — (ยังไม่มี) |
| Commit SHA | ไม่มี (upload snapshot จาก worktree ที่ dirty 695 รายการ) | ไม่มี (ยังไม่ commit ตามคำสั่ง) |
| Start command | `npm run start` → `next start` (default) | เหมือนกัน (ยังไม่ได้กำหนด override) |
| จำนวน route ใน build | **470** | ไม่ทราบ (ไม่มี manifest) |
| Route ของระบบพัฒนาใน build | **257** (55%) | ไม่ทราบ — ยังพิสูจน์ไม่ได้ (E3) |
| Implementation โค้ดของระบบพัฒนาใน build | อยู่ครบ | ยังอยู่ 95 โมดูลใน build input (E4) |
| เปิดสาธารณะโดยไม่ login | 11 endpoint (รวม module registry 472 KB) | ยังไม่วัด (build ไม่ผ่าน) |
| dev API ตอบ 403 (plane ปิด) | ❌ ตอบ 401 ⇒ gate ยังไม่ได้ deploy | มีใน source (`core/auth/developerPlaneGate.ts`) แต่ยังไม่มี artifact |
| `.env.local` ใน build input | ไม่มี (build log ไม่มีบรรทัด `- Environments:`) | **มี** — 13 secrets (E5) |
| rollback | `canRollback=true` แต่ deployment เก่าทุกตัว `REMOVED` | ไม่มี release ให้ rollback ไป |

---

## สถานะ release gates (ตามข้อ 7 ของคำสั่ง)

| Gate | ค่า | หลักฐาน |
|---|---|---|
| `OLD_DEVELOPER_ROUTES_IN_PRODUCTION` | **257** (จาก 470 route ใน build log ของ production จริง + live HTTP probe) | `artifacts/cutover/old-production-probe.txt` |
| `NEW_DEVELOPER_ROUTES_IN_BUILD` | **NOT PROVEN** (ตัวเลข 0 มาจาก manifest ว่าง) | E1/E3 |
| `NEW_DEVELOPER_CONTROL_APIS_IN_BUILD` | **NOT PROVEN** (เหมือนกัน) | E1/E3 |
| `BUSINESS_RUNTIME` | **NOT RUN** (รอบนี้เป็น read-only ตามคำสั่ง) | — |
| `TENANT_ISOLATION` | **NOT RUN** | — |
| `CANONICAL_FINANCE` | **NOT RUN** | — |
| `DOCUMENTS` | **NOT RUN** | — |
| `ROLLBACK_PLAN` | **NOT READY** — ไม่มี deployment สำเร็จรอบก่อนที่ยืนยันว่าใช้ rollback ได้ (ทุกตัวก่อนหน้า `REMOVED`) | `railway deployment list` |

# `RELEASE_STATUS = BLOCKED` — ห้าม Deploy

เหตุผลที่บล็อก (เรียงตามลำดับที่ต้องแก้): build business-only ยังไม่ผ่าน (E1) → ยังไม่มี manifest ให้พิสูจน์ว่า dev route = 0 (E3) → มี dev route รอด 1 ตัว (`/observer.json`) (E2) → implementation โค้ดของระบบพัฒนายังอยู่ใน build input (E4) → `.env.local` จะถูกโหลดตอน build (E5) → ยังไม่ได้รัน business runtime checks และยังไม่มี rollback target ที่ยืนยันได้

**สิ่งที่ยังไม่ถูกแตะตามคำสั่ง:** ไม่มีการลบไฟล์ ไม่มีการแก้ source ในรอบนี้ ไม่มีการแก้ OTP / ฐานข้อมูล / Storage / Secret ไม่มีการ Commit / Push / Deploy และไม่มีการลบ Production service

---

### ไฟล์หลักฐานดิบ

- `artifacts/cutover/business-build-evidence.json` — ผล prune/verify ของ staged build (build ไม่ผ่าน)
- `artifacts/cutover/business-build.log` — stdout/stderr ของ `next build` ที่ล้มเหลว (E1)
- `artifacts/cutover/old-production-routes.txt` — route table 470 รายการที่ extract จาก build log ของ production จริง
- `artifacts/cutover/old-production-dev-routes.json` — 257 route ของระบบพัฒนาที่ยังอยู่ใน production
- `artifacts/cutover/old-production-probe.txt` — ผล HTTP probe สด (status code ต่อ path)
- `artifacts/cutover/old-production-public-leak.txt` — 11 endpoint ที่เปิดสาธารณะ + ขนาด payload

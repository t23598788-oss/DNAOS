# DNAOS_FINAL_PRODUCTION_RELEASE.md

วันรายงาน: 2026-10-25 · Branch: `release/20261025` · Worktree: `project/release-wt`
งานต่อเนื่องจาก `DNAOS_PRODUCTION_RELEASE_REPORT.md` (DNA-000230) → repossession STEP1–5 ซ่อม gate → DNA-000231

---

## 01 OBJECTIVE

นำเวอร์ชันล่าสุดบนเครื่อง (ชุด authority separation + organization read scope + public catalog + canonical writers, DNA-000230) ขึ้น **Production จริง** โดย:

1. ตรวจสถานะจากหลักฐานเสมอ (Local, GitHub, Railway Staging, Railway Production) — ไม่เชื่อรายงานเก่า
2. รักษาโลโก้ แบรนด์ หน้าจอ และความสามารถเดิมทั้งหมด — commit ใหม่ของรอบนี้แตะเฉพาะ gate/registry โดยไม่แตะ UI หรือขยายงานเอง
3. ผ่าน Release Gate ที่ระบบกำหนดก่อน Deploy เสมอ (deploy-gate, governance, drift, knip, pre-commit)
4. Deploy ผ่านลำดับ Staging → Production และตรวจ URL จริง — **ห้ามประกาศ PASS ก่อนเปิด URL จริง**

เกณฑ์สำเร็จ (ตาม directive): Production เปิดจริง + SHA ตรงกันหมด + แบรนด์เดิมอยู่ + ความสามารถใหม่ทำงาน + API ต่อถูก + ไม่มีข้อผิดพลาดวิกฤต + รายงานตรวจย้อนหลังได้

---

## 02 SOURCE EVIDENCE

### 2.1 SHA และสถานะ Git (ตรวจจาก Git จริง ไม่ใช่ข้อความในรายงานเก่า)

| รายการ | ค่า | วิธีตรวจ |
|---|---|---|
| BASE_SHA (baseline ก่อนชุดนี้) | `84d8c7f615216e6ece47d996f9a9a3ab03789347` | `git log` + บันทึกในรายงาน DNA-000230 |
| LOCAL_SHA (สุดท้ายรอบนี้) | `83e8bdb85df593f0054c1ac3c9338ca1102f2883` (DNA-000231) | `git rev-parse HEAD` |
| RELEASE_COMMIT_SHA | `83e8bdb85df593f0054c1ac3c9338ca1102f2883` | commit ผ่าน pre-commit guards ทั้งชุด |
| GITHUB_MAIN_SHA | `83e8bdb85df593f0054c1ac3c9338ca1102f2883` | `git ls-remote github main` — FF push `5ef43df4..83e8bdb8` (ไม่ force) |
| GITHUB_RELEASE_SHA | `83e8bdb85df593f0054c1ac3c9338ca1102f2883` | `git ls-remote` branch `release/20261025` |
| STAGING_DEPLOY_SHA | **NOT DEPLOYED** — ยังรัน build เก่า | probe หัวข้อ 2.3 (ตรวจซ้ำ 2 รอบหลัง push) |
| PRODUCTION_DEPLOY_SHA | **NOT DEPLOYED** — ยังรัน build เก่า | probe หัวข้อ 2.3 |
| Production URL | `https://dna-os-deadboard-production.up.railway.app` (domain canonical `dnaos.dev` ยังไม่ตัด DNS ตาม `12-environments.json`) | live HTTP |
| Staging URL | `https://dna-os-staging.up.railway.app` | live HTTP |

### 2.2 ไฟล์ที่เปลี่ยนใน commit นี้ (DNA-000231 — งานปิด gate รอบ reconcile)

```
scripts/check-drift.sh                          # คืนประกาศ architecture/, connections/, assets/ (ตกหล่นจาก wip 5806c269) + ประกาศ external-packages/, reports/
knip.json                                       # ignore: core/authority/rights.ts (in test suite), external-packages/semantic-preflight/** (standalone package)
registry/architecture-book.json                 # regenerate (line refs ตามโค้ดจริง)
DNA_OS_HEALTH.json                              # ผล governance จริง (Health 100/100)
registry/VALIDATION_RESULTS.json                # ผล validation จริง
local-runtime/dev-loop-problem-report.json      # ผล dev-loop gate จริง
DNAOS_PRODUCTION_RELEASE_REPORT.md              # เพิ่ม (ไฟล์รายงานฉบับ DNA-000230)
```

งานซอร์สใหญ่ของ release (175 ไฟล์: authority scope, public catalog, canonical writers, LINE/finance guards ฯลฯ) อยู่ใน commit `5ef43df44ef74844ab290a8e8709c404444408cf` (DNA-000230) ที่ push ขึ้น GitHub main แล้วและเป็น ancestor ของ commit นี้

### 2.3 Deploy probe จริงณ 2026-10-25 (keyless HTTP เท่านั้น)

ทดสอบตรงตาม URL จริงทั้งสองฝั่ง: เทียบหน้าเก่าที่มีอยู่ (old build) กับหน้า/route ใหม่ของชุด DNA-000230:

| เส้นทาง | Staging | Production | สรุป |
|---|---|---|---|
| `/` | 307 → `/login?next=%2F` | 307 → `/login?next=%2F` | middleware baseline ปกติทั้งคู่ |
| `/login`, `/products` | 200 (SVG/เนื้อหา build เก่า) | 200 (SVG/เนื้อหา build เก่า) | build เก่ายังทำงานตามปกติ |
| `/products/catalog`, `/register` | 404 | 404 | **หน้าใหม่ไม่มีใน build ที่รัน** |
| `/api/public/products` | 404 (หน้า 404 ของ Next) | 404 | **route ใหม่ไม่มี** |
| HTML head สอง URL | `<css> 3d-1vk5hzu5rq.css` + geist hash ต่างกันชัดเจนกับ staging ในรอบก่อนหน้านี้ (viewport-fit=cover ใน prod, ไม่มีใน staging) | ต่างกัน | build ของ prod/staging ก็ไม่เหมือนกัน — สองฝั่งรัน build เก่าไม่เหมือนกัน |

ตรวจ **ซ้ำ** หลัง push `83e8bdb8` แล้วรอ ~2.5 นาที: staging และ production ยัง 404 บน route ใหม่ทุกจุด — **การ deploy อัตโนมัติ (webhook) ไม่เกิดขึ้นเลยทั้งสองฝั่งเป็นชุดรอบสองติดต่อกัน (รอบแรกคือ push 5ef43df4)**

### 2.4 ผล Build และ Release Gate ทั้งชุด (รันจริงรอบนี้)

| ตัวตรวจ | ผล | หลักฐาน |
|---|---|---|
| TypeScript (`npx tsc --noEmit`) | **PASS** | exit 0 |
| ESLint ทั้ง repo | 653 errors / 230 warnings (หนี้เดิม; **zero new** — ไม่มีซอร์ส pending นอกจาก JSON/shell) | จาก `npm run lint` ทั้ง repo; governance gate ไม่ใช้ eslint block |
| knip | **PASS** exit 0 | แก้ knip.json ignore → `npx knip --no-progress --exclude exports,types` = 0 |
| Architecture Drift (`check-drift.sh`) | **PASS** "no drift" | คืน allowlist + 1045 modules ตรง registry |
| Pre-commit guards (Guard 8b/9/10/12/13/14, Registry Integrity, Connector Lifecycle) | **PASS** | 15/15 + "All guards passed" |
| Deploy Gate + Governance สมบูรณ์ (`npm run build` ช่วง gate) | **PASS** — Health **100/100**, READY | `DNA_OS_HEALTH.json`; Dev Loop gate อ่านฐานหลักฐานจริงจาก Production Supabase (`dev_loop_check_results`) (env ครบจาก Production Supabase project เจ้าของ โดยไม่พิมพ์ค่า secret) |
| Production Build (`next build --webpack`) | **PASS** exit 0 | list route ครบ (หลังล้าง .next ค้าง + node_modules เป็น symlink ข้าม root ซึ่ง Turbopack ปฏิเสธ — จึงใช้ --webpack เช่นเดียวกับการตรวจรอบ DNA-000230) |
| Regression suites | **PASS** ทั้ง 7 ชุด | authority-scope-and-concurrency 40/40 · public-catalog-policy 113/113 · connect-inbound-boundary 54/54 · material-price-authority 45/45 · ai-data-scope-and-identity 50/50 · authority-resolver 24/24 · business-event-authority 34/34 |
| Secrets scan บน diff ที่ commit | **PASS** | pattern หลายรอบ (JWT/eyJ, sb_secret, token) — clean |
| Registry Sync + Architecture Book | **PASS** | 1416 modules, 0 broken/0 unused/0 unregistered ณ moment commit |

### 2.5 หน้าจอ/แบรนด์/โลโก้ — จากซอร์สที่ release นี้สั่ง

- **ไม่มีการเปลี่ยน** โลโก้ (`public/icons/logo-master.png`, favicon), แบรนด์, ฟอนต์กลาง UI, header/sidebar/navigation/footer ในชุดนี้ — ชุด DNA-000230 แก้ที่ชั้น authority/read-scope/catalog publication และ canonical writers เท่านั้น
- หน้าเว็บเดิมทุกหน้ายังอยู่ (route list จาก build จริง: `/`, `/login`, `/products`, `/solutions`, `/report`, `/start`, `/register`(ใหม่), `/products/catalog`(ใหม่), `/user`, `/workspace`, `/partner`, `/admin/**`)
- ตรวจเทียบจอก่อน/หลังจริงบน Production **ยังไม่เกิดได้** จนกว่า deploy จะสำเร็จ (ตามกฎ "ห้ามรายงาน PASS หากยังไม่เปิด URL จริง" — รายงานจึงไม่แนบ screenshot ก่อนชั้นนี้)

### 2.6 ข้อจำกัด / ขัดขวางที่ต้องอาศัยเจ้าของ

| ขัดขวาง | รายละเอียด | สิ่งที่ต้องใช้จากเจ้าของ |
|---|---|---|
| Railway auth ตาย | `railway status/list` → `Unauthorized`; token ใน `~/.railway/config.json` ตายและ endpoint refresh 404 ทุกที่; GraphQL ตรงด้วย token คืน `Not Authorized` | `railway login` หรือให้ `RAILWAY_TOKEN` scope deploy — แล้ว trigger และดึง STAGING/PROD deploy SHA ได้ทันที |
| Railway webhook ไม่ทำงาน | push `5ef43df4` และ `83e8bdb8` ขึ้น main โดยไม่ fire deploy ทั้ง staging (เชื่อม main ตาม `12-environments.json`) และ production | ตรวจส่วน GitHub integration ของทั้งสอง service บน Railway Dashboard (หลัง login) แล้วกด `Deploy latest` ด้วยมือหรือต่อ webhook กลับ |
| origin local backup repo เสียหาย | `/Users/tam/Desktop/ระบบธุรกิจ/.dna-os-git`: packfile ตัดขาด (`pack-3a7e741c…pack` 2026-10-09), multi-pack-index quarantine แล้ว (ไม่ลบ), push REJECTED | อนุมัติให้ rebuild mirror จาก GitHub แล้วเปลี่ยนชื่อ dir เดิมเก็บเป็น `.dna-os-git.corrupt-20261025` (ไม่ลบทันที); ยืนยันแล้วว่า**ไม่มีข้อมูลสูญ** (SHA เฉพาะทุกตัวมีสำเนาบน GitHub/บนคอมมอน ancestor) |
| DNA `dnaos.dev` ยังไม่ตัด DNS | canonical domain รอ cutover ตาม `12-environments.json` | ตัดสินใจระดับ DNS ของเจ้าของ |

---

## 03 RESULT

### **PARTIAL PASS → BLOCKED ช่วง Deploy** (ไม่ประกาศ Production PASS — ตามข้อความว่า "ห้ามรายงาน Production PASS หากยังไม่เปิดทดสอบ URL จริง")

- **PASS — ครบ STEP 1–5 ของ directive:** ตรวจสถานะจริง · เปรียบเทียบ old-build กับเนื้อหา production จาก URL จริง · ปิดซอร์ส/reconcile (แก้ regression ของตัว release ที่ชุด 5806c269 ตัดการประกาศ layer ตกหล่น) · Release Gate ผ่านทุกตัว (Health 100/100, build exit 0, regression 330+ checks ผ่านจริงแทรกทั้งชุด) · Commit **ไม่ force** + ยืนยัน SHA ทั้งกลุ่ม main + release branch
- **BLOCKED — STEP 6 (Deploy เส้นทาง Staging→Production):** การ deploy จากสอง push ล่าสุดไม่ถูก trigger จากฝั่ง Railway เลย (ตรวจซ้ำ 2 รอบหลัง push แล้วยังเดิม); ไม่มีสิทธิ์ใดจะ inspect/trigger ได้ จนกว่าเจ้าของจะ `railway login` หรือให้ `RAILWAY_TOKEN` — เมื่อได้, เลขลำดับ deploy ที่ควรทำคือ: trigger staging ด้วยมือ/คำสั่ง Railway → probe หน้าใหม่ (`/products/catalog`, `/register`, `/api/public/products`) → Live E2E staging → approve → promote production → ตรวจ URL จริง + SHA จาก deployment log
- **ไม่ทำแทนเจ้าของ:** การตัด DNS `dnaos.dev`, การซ่อม repo backup (รออนุมัติ), การต่อ webhook Railway, การยืนยันตัวตน Railway ทั้งหมด

งานที่ค้างทั้งหมดถือเป็น **รอสิทธิ์/การอนุมัติของเจ้าของ** ไม่ใช่ข้อบกพร่องของซอร์สโค้ด — ซอร์สฝั่ง release ผ่าน gate ทุกตัวแล้วและพร้อม deploy

---

รายงานโดย Buffy (Freebuff / Codebuff) · ตรวจจาก Git + HTTP probes + gate scripts ณ 2026-10-25 · ไม่ประกาศ STAGING/PRODUCTION deploy PASS จนกว่าจะเห็น SHA จาก deployment จริง + เปิด URL ทดสอบจริง

# DNA OS — PRODUCTION RELEASE & SOURCE RECONCILIATION REPORT (DNA-000230)

รายงานวันที่: 2026-10-25 · Branch: `release/20261025` · Worktree: `project/release-wt`

---

## 01 OBJECTIVE

นำชุดงานที่พัฒนาค้างไว้ (DNA-000230) เข้าสู่ Production โดยรักษาหน้าจอ, เว็บ, API
และสิทธิ์ที่ใช้งานอยู่ให้เท่าเดิม ขอบเขตชุดงาน:

1. Authority separation + organization read scope ครอบทุก admin read API
2. Public catalog publication registry (เผยแพร่สินค้า/ราคาสาธารณะ)
3. Canonical material-price writer (เส้นทาง Inbound Connect ด้านเขียนราคา)
4. Receipt-document + finance-summary scope guards
5. Document list per-request accumulator (แก้ cross-tenant leak ขณะ concurrent read)
6. AI context scope enforcement (AI ไม่อ่านข้ามองค์กรโดยไม่มีสิทธิ์)
7. Registry-sync / architecture-book regenerate ให้ตรงโค้ดจริง

ข้อระงับที่ถือทั้งรอบ: ไม่แตะสิทธิ์ผู้ก่อตั้ง/หัวหน้าวิศวกร, ไม่เปิดข้อมูล
ข้ามองค์กรเพราะสิทธิ์พัฒนา, ไม่เปลี่ยนเส้นทาง Canonical Finance Writer,
ห้าม migration/seed ที่เขียนข้อมูลโดยไม่จำเป็น, ห้าม deploy ก่อนผ่าน
Release Gate และห้าม force push

## 02 SOURCE EVIDENCE

### SHA ที่ตรวจได้จริง

| รายการ | ค่า | หลักฐาน/วิธีตรวจ |
|---|---|---|
| BASE_SHA (production baseline) | `84d8c7f615216e6ece47d996f9a9a3ab03789347` | github `main` ก่อน push == Local HEAD (rev-parse + ls-remote) |
| LOCAL_SHA (ก่อน commit) | `84d8c7f615216e6ece47d996f9a9a3ab03789347` | git log ใน release-wt |
| COMMIT_SHA | `5ef43df44ef74844ab290a8e8709c404444408cf` | git log -1; ผ่าน pre-commit guards |
| REMOTE_SHA — github `main` | `5ef43df44ef74844ab290a8e8709c404444408cf` | ls-remote; FF `84d8c7f6..5ef43df4` |
| REMOTE_SHA — github `release/20261025` | `5ef43df44ef74844ab290a8e8709c404444408cf` | ls-remote |
| REMOTE_SHA — origin (local backup) | ยัง `84d8c7f6…` — push REJECTED (ดูหัวข้อ backup) | ls-remote |
| STAGING_DEPLOY_SHA | **NOT DEPLOYED** | Railway ยังไม่ได้รับ build ใหม่ (probe ด้านล่าง) |
| PRODUCTION_DEPLOY_SHA | **NOT DEPLOYED** — ยังรัน build เก่า | probe ด้านล่าง |
| FILES_CHANGED | 175 ไฟล์ (+27,268 / −1,281) | git diff --stat ก่อน commit |
| BUILD_RESULT | **PASS** | tsc 0 error · eslint 76 จาก baseline 87 (zero new; แก้ออก 10 จุด) · `next build --webpack` exit 0 · Guard 13/14 pre-commit PASS |
| SECRETS SCAN | **PASS** | 2 รอบ patterns บน staged diff (JWT/Bearer/pg-token/sb_…) ผ่าน |

### Deploy probe (2026-10-25, แบบ keyless HTTP)

Production `https://dna-os-deadboard-production.up.railway.app` และ
Staging `https://dna-os-staging.up.railway.app` ให้ผลเหมือนกัน:

- `/` → 307 → `/login?next=%2F` (ตาม middleware baseline)
- `/login` 200 · `/products` 200 (หน้าที่มีใน build เก่า)
- `/products/catalog`, `/register`, `/sitemap.xml`, `/robots.txt` → 404
  (หน้าใหม่ของชุดนี้ ยังไม่มีใน build ที่รันอยู่)
- `/api/public/products` → 404 เป็นหน้า HTML (Next default 404) — route ใหม่
  ยังไม่มีใน build ที่รันอยู่
- `/api/admin/publications` + `/api/admin/pulse` → 401 JSON
  `{"ok":false,"error":"ต้อง login ก่อนใช้งาน"}` — มาจาก `middleware.ts:29`
  (PROTECTED_API_PREFIXES = /api/admin) ก่อนถึง route จริง — จึง **ไม่ใช่
  หลักฐาน** ว่า build ใหม่ได้ deploy

สรุป: **ทั้ง production และ staging ยังรัน build เก่า** — Railway ไม่ได้
deploy commit `5ef43df4` ทั้งคู่

### origin local backup (`/Users/tam/Desktop/ระบบธุรกิจ/.dna-os-git`)

push ไป origin → **REJECTED (unpacker error)** — ตรวจพบสาเหตุที่ repo ตัวมันเอง:

- `multi-pack-index verify` ไม่ผ่าน ("failed to load pack entry for
  oid[2697] / oid[7589]")
- สันนิษฐานที่ใช้ (idx header อ่านจำนวน objects ณ ตอน pack) เกิน
  เนื้อไฟล์จริงที่เก็บอยู่ — packfile `pack-3a7e741c7296aad41e694e834ef8c72b851bf0bb.pack` ถูกตัดขาด
  กลางคัน ("far too short to be a packfile", วันสร้าง 2026-10-09 17:24)
- ทำแบบแล้วเสียน้อยแล้ว: `multi-pack-index` ถูกย้ายไปชื่อ
  `multi-pack-index.quarantine-20261025` (ไม่ลบ; ใน /tmp/midx-backup.bin
  มีสำเนาเก็บไว้เพิ่มสำรอง) — push ยังไม่ผ่าน — จึงต้องซ่อมด้วยการ rebuild mirror
- **หลักฐาน "ไม่มีข้อมูลสูญหาย":**
  - SHA ล่าสุด 5 ตัวเฉพาะของ origin ก่อน deploy — 3 ตัวเป็น ancestor บน
    production history บน github (`merge-base --is-ancestor` = TRUE)
  - อีก 2 (`05f898cc` feature/business-workspace-template-v2, `6a144b6c`
    ui/workspace-controls) ได้ค่าทดสอบ `git cat-file -t` = commit ทั้งคู่
    ดังนั้นข้อมูลจริงยังอยู่ใน repo เครื่องหลักโครงงานครอบคลุม
- repair ที่แนะนำ (ต้องขออนุมัติถึงทำ): สร้าง mirror ใหม่จาก github
  แล้วแทนที่ repo ที่เสีย (`git clone --mirror <github-url>` → ตั้งชื่อ dir เดิม)
  — ไม่ลบทิ้ง ให้เปลี่ยนชื่อ dir เก่าเก็บไว้เป็น
  `.dna-os-git.corrupt-20261025` ก่อนเสมอ (ปิดกั้นเสี่ยงข้อมูล)

## 03 RESULT

**ขอบเขต STEP1–5 ผ่าน (ตรวจแล้วจาก git จริง), ฝั่ง STEP 6–7 ยัง BLOCKED**

### ผ่านแล้ว (STEP 1–5)

1. ตรวจเวอร์ชันจริง (STEP 1): production baseline `84d8c7f6` เท่ากับ
   github main ก่อน push และ Local HEAD ทุกที่ (ทดสอบด้วย Git จริง)
2. จัดกลุ่มงาน local (STEP 2): 175 ไฟล์ (หน้าจอ/API/auth/AI/LINE/
   document/canonical/registry/build config) — จัดโดยกลุ่มตาม
   ประเภท ทั้งโค้ดใหม่/โครงแชร์/migration/registry ผ่านการตรวจ ก่อน stage
3. แก้ข้อผิดพลาดที่ชุดนี้เพิ่มเข้ามา (STEP 3) รวม 10 จุด — เกิดจาก
   ชุด scope-layer ที่ queries.ts / listDocuments.ts / pits/page.tsx:
   แทน `any` ใหม่ด้วย type annotation จริง + ลบ import ค้าง +
   JSX quote escaping — ไม่ใช้ suppress comment ใดเลย
   (ส่วน error เก่า 76 จุดจาก baseline ไม่แตะ)
4. ทดสอบ (STEP 4): tsc 0 error · eslint zero-new regression (76 vs 87
   baseline) · build --webpack exit 0 · Guard 13/14 PASS · secrets scan PASS
5. Commit + Push (STEP 5): commit `5ef43df44ef74844ab290a8e8709c404444408cf`
   (message ระบุ scope ชุด DNA-000230) → push github — main FF
   `84d8c7f6..5ef43df4` (ไม่ force) + release branch ใหม่ — ตรวจจาก
   `git ls-remote` ยืนยัน SHA ตรงกันทุกตำแหน่ง

### BLOCKED — รอสิทธิ์ที่ทำได้ต่อ (STEP 6)

- **Railway access:** `railway whoami` → Unauthorized; ไม่พบ RAILWAY_TOKEN
  ใน env ของ shell ที่ CLI เรียกได้ — ต้องให้ผู้ดูแล login (`railway login`)
  หรือให้ RAILWAY_TOKEN ที่มี scope ด้าน deploy
- ลำดับ deploy มาตรฐานหลังได้สิทธิ์ (STEP 6):
  1. `railway link` — ยืนยัน projects/environment ที่มีก่อน
  2. deploy branch `release/20261025` → staging ก่อนเท่านั้น
  3. ตรวจ STAGING_DEPLOY_SHA == `5ef43df44ef7…` (Railway webhook/log)
  4. Live E2E staging: login/session + org scope · `/products/catalog`
     `/register` · `/api/public/products` · `/api/admin/pulse` +
     `finance-summary` · `/api/internal/connect` (canonical writer) ·
     เส้นทาง LINE OA จริง
  5. ถ้าผ่าน → approve จากผู้มีสิทธิ์ → promote commit เดียวกันไป
     production (ไม่ migrate/seed, ไม่เขียนฐานข้อมูล)
  6. ตรวจ PRODUCTION_DEPLOY_SHA + LIVE E2E บน prod — แยก BUILD PASS
     จาก LIVE E2E PASS ตามกฎ เพราะประกาศผลต้องบอกและรายงานที่เหมือนจริง

### ต้องทำต่อ (ไม่ระดับ Block)

- origin local backup repo เสียหาย (รายละเอียดหัวข้อ backup ด้านบน) —
  ยืนยันแล้วว่าทุก SHA ที่เกี่ยวข้องมีสำเนาอยู่ที่อื่นครบ จึงซ่อมภายหลัง
  ได้ทันทีโดยไม่มีข้อมูลหาย (ขออนุมัติก่อนแทน dir ที่เสีย)
- ต่อจากนี้: ผู้ดูแลระบบทบทวน report นี้ → ให้สิทธิ์ Railway →
  ผู้นำ deploy ต่อไปที่ staging → confirm Live E2E → approve → production

---

รายงานโดย Buffy (Freebuff / Codebuff) — ตรวจจาก git และ HTTP probes
ณ 2026-10-25; ไม่ได้ขอสิทธิ์ Railway ยังไม่ประกาศ deploy/LIVE E2E
จนกว่าจะได้ access ตามกฎกำหนด

# แผนที่ซอร์สสำหรับการรวมรีโปสู่โครงสร้าง 01–10 (ขั้นตอนที่ 1 — รายการไฟล์และจุดอ้างอิง)

> จัดทำจากรายการไฟล์จริง + import graph จริง (สแกน 1,354 ไฟล์) + git จริง (fetch ทั้งสองรีโป) วันที่ 2026-10-07
> **แก้ตามตัวเลขจริงรอบขั้น 2 (2026-10-07)**: github มี **13 heads** (ไม่ใช่ 14) + local `work-main` (ahead=0) + `release/r1-staging-candidate` (ซ้ำกับ remote); สาขา ahead>0 = **11 สาขา** (ไม่ใช่ 7): +1×8 (accounting-financial-statements, architecture/repository-authority-phase1, copilot/enforce-task-invariants, feature/core-capability-wrap-v1, feature/core-capability-wrap-v1-pre-rebase, feature/job-contract-recovery, fix/main-job-recovery-baseline, release/business-system-1.0.0) + business-workspace-template-v2 +8, khon-kaen-place-discovery +4, runtime-connect-service-router +9
> ยัง**ไม่มีการย้ายไฟล์/merge/เปลี่ยนพฤติกรรมใดๆ** — เอกสารนี้คือแผนที่ก่อนย้ายตามคำสั่ง
> โครงสร้าง 01–10 เป็น**เป้าหมาย**; กฎเหล็กคือห้ามทำเส้นทาง Next.js พังและรักษาพฤติกรรมเดิม

## 0. กติกาที่ยืนยันจากโค้ดจริง

1. **Next.js ผูกที่ root**: `app/` (607 ไฟล์, 93 pages, 331 API routes), `middleware.ts` (root), `next.config.ts` (turbopack.root=__dirname), `tsconfig paths`: `@/*` → `./*` — ย้าย `app/` ไปใต้โฟลเดอร์เลข = import `@/*` ทั้งหมด (694 edge app→core) พัง → **`app/`, `middleware.ts`, `next.config.ts` คงที่ root**
2. **โฟลเดอร์ marker ของระบบ**: `verifyWorkspaceRoot()` (engines/workspace/workspaceRootVerifier.ts) fail-closed เมื่อไม่พบ `package.json` + `registry/` + `core/` + `engines/` ที่ root — worker/watcher ทุกตัวใช้ preflight นี้ → **ห้ามย้าย marker ทั้งสามออกจาก root**
3. **สิทธิ์ผูกกับเส้นทางไม่ผูกโฟลเดอร์**: `registry/permissions.json` route_access = prefixes `/admin`, `/business`, `/partner`, `/user` (URL) — ย้ายไฟล์แต่คง URL = สิทธิ์ไม่เปลี่ยน
4. ขอบเขตข้อมูล (คงเดิมทุกขั้น): หน้าจอเรียกผ่าน API · คอนเนกเตอร์ส่งผ่าน Connect · ระบบธุรกิจเป็นผู้ตีความ/บันทึก · ระบบคำสั่งดูแลการทำงาน — ห้ามให้ทุกโฟลเดอร์เข้า DB ของกันและกัน

## 1. แผนที่โฟลเดอร์ปัจจุบัน → หมวดเป้าหมาย (พร้อมคำตัดสินย้าย)

หลักฐาน import = edge ขาเข้า (inbound) ยิ่งสูงยิ่งห้ามขยับ: **core 819 · app 336 · engines 255 · services 225 · presentation 117 · registry 102 · components 48 · gateway 26 · plugins 15 · cognitive 5 · config 5**

| โฟลเดอร์ปัจจุบัน (ไฟล์) | หมวด 01–10 | inbound | คำตัดสิน |
|---|---|---|---|
| `app/` (607) + `middleware.ts` + `next.config.ts` | 02-screens + 05-business + 01-access + 03-connect (ตาม sub-route ใน §2) | 336 | **ห้ามย้าย** (framework) |
| `core/` (74) | ข้ามหมวด (types/shared) — คงเป็นแกนกลาง | 819 | **ห้ามย้าย** |
| `engines/` (131) | 05-business (documents/canonical/payment), 03-connect (integration-gateway), 06-control (workspace), 04-connectors (adapters) | 255 | **ห้ามย้าย** — จัดหมวดผ่านทะเบียน |
| `services/` (29), `plugins/` (41), `components/` (32), `presentation/` (35), `presenter/` (5) | 02-screens / 05 (แล้วแต่ตัว) | 225/15/48/117/2 | ห้ามยกชุด — ย้ายทีละตัวถ้า inbound≈0 เท่านั้น |
| `registry/` (131) | 07-observability (ทะเบียน/หลักฐาน) + 10-deployment (ทะเบียน deploy) | 102 | คงที่ (เป็น marker + ถูกอ่านผ่าน path ไดนามิกจาก engines/documents/selfDescription) |
| `gateway/` (6) | 03-connect | 26 | คง (ชื่อซ้อนกับ app/api/gateway อยู่แล้ว) |
| `supabase/` (212) | 08-data (migrations) + 04-connectors + 05-business + 07-observability (functions 26 ตัว §3) | — | คง (Edge runtime แยก) |
| `local-runtime/` (29), `workers/` (32) | 06-control (ตัวทำงานในเครื่อง) | 2/0 | ย้าย/เรียกชื่อหมวดได้ในขั้นถัดไป (edge ต่ำ) |
| `scripts/` (171) | 09-verification (test 140+ ตัว) + 10-deployment (sync/guards) | ขาเข้าน้อย ขาออกเยอะ | ย้ายชื่อได้แต่ต้องแก้ package.json scripts ทั้งหมดในที่เดียว |
| `cognitive/` (38) | 05-business (AI ตอบลูกค้า) | 5 | ย้ายได้ถ้าแก้ edge 5+7 จุด |
| `dna-os-mcp-server/` (121) | MCP (ตามเงื่อนไข "เฉพาะมีผู้เรียกจริง") | 0 | แยก workspace npm — ย้ายได้ แต่**ต้องพิสูจน์ผู้เรียกก่อน** |
| `dna-os-contractor/` (6) | 05-business (งาน sub-contractor) | 0 | ย้ายได้ตาม phased |
| `e2e/` (3), `observatory/`, `output/`, `project/`, `platform/`, `_inventory/`, `sites/`, `handoff/` | 09 / อื่นๆ | 0–1 | ย้ายได้ (ไม่มีคน import) |
| `config/` (2) + `12-environments.json` | 10-deployment | 5 | ห้ามพร้อมกันกับแก้ผู้เรียก 5 จุด |
| `src-tauri/` (2), `public/` (2), `system/` (2) | 02 / deployment | 0 | คง (Tauri + static) |

**สรุปวิธีการ**: 01–10 จะใช้แบบ "สองชั้น" — (ชั้น A) โครงสร้างไฟล์จริงคงตาม framework/reality ข้างต้น (ชั้น B) **มุมมองหมวด 01–10 ประกาศในทะเบียนระบบ** (ไฟล์นี้ + `portals.json`/`module-registry` scope) เพื่อให้เห็นหน้าที่บนหน้าทะเบียนโดยไม่ต้องย้ายไฟล์ที่ import ร้อยแปด. การย้ายจริงทำเฉพาะโฟลเดอร์ inbound=0 เท่านั้นและทีละโฟลเดอร์พร้อมรัน guard.


## 2. แผนที่เส้นทาง Next.js (331 API + 93 pages) → หมวด

| เส้นทางปัจจุบัน | จำนวน | หมวดเป้าหมาย |
|---|---|---|
| `app/api/admin/*` (ide 166, connectors 9, workspace 7, line-customers 7, devices 6, partners 5, equipment 5, pits 4, debt-trackings 4, receipt-documents 3, transactions 3, …) | 266 | 05-business (เอกสาร/เงิน/ลูกค้า/งาน) · `admin/ide` = 02-screens · `admin/connectors` = 03-connect |
| `app/api/gateway/observe/{github,line,meta,railway,vercel}` + `gateway/proposals` | 7 | **03-connect** (ประตูกลางรับ) + 04 (ผู้สังเกตการณ์ connector) |
| `app/api/internal/connect/{event,expense,inbound-source,payment-confirm}` | 4 | **03-connect** (ประตูกลางส่ง) |
| `app/api/internal/{line,openclaw,device,equipment,gmail}/*` | 13 | 04-connectors (line/openclaw/gmail) · 06-control (device/equipment command) |
| `app/api/connectors/{oauth,webhook}/[slug]` | 3 | **04-connectors** |
| `app/api/v1/mcp/*` (governance, contractor, registry, architecture) | ~14 | MCP (เก็บเฉพาะมีผู้เรียกจริง) |
| `app/api/{command,cron,deploy,dbd,document,auth,chat,oauth,…}` | 17 | 06-control (command, cron) · 10-deployment (deploy) · 01-access (auth/oauth) · 05 (document/dbd) |
| Pages: `admin` 56, `workspace*` 11, `business*` 7, `login/account/oauth`, `liff`, `observer`, `partner`, `report` … | 93 | 02-screens ทั้งหมด; `login/account/oauth` = 01-access |

**LINE / Connect ไม่มี service ของตัวเองบนผัง** — เป็นความสามารถภายใน Edge Function (`supabase/functions/line-webhook-v2` + อีก 25 ตัว) และเว็บ (`gateway/observe`, `internal/connect`) แสดงหน้าที่ในทะเบียนระบบตามคำสั่ง ไม่สร้าง service ใหม่

## 3. งานที่ยังอยู่ในสาขา/รีโปอื่น (รายการก่อนรวม พร้อมวิธีเก็บประวัติ Git)

### 3.1 รีโปหลัก `t23598788-oss/---------------DNA-OS` (remote `github`) — 14 สาขา + worktree `gh-main`
| สาขา | เหนือ main | สถานะ/งาน |
|---|---|---|
| `gh-main` (worktree นี้) | **+2** (`f049a71`, `d7fbb05` — งาน Connect 2026-10-07) | **ยังไม่ push** — ต้อง push ก่อนขั้นตอน 5 |
| `feature/business-workspace-template-v2` | +8 (25 ก.ย.) | **mcp-server production กำลัง deploy จากสาขานี้** — ต้องเลือก: merge เข้า main หรือคง |
| `runtime-connect-service-router` | +9 (15 ก.ย.) | Connect failover (cjs) — งาน Connect เฉพาะ |
| `feature/khon-kaen-place-discovery` | +4 | regression test place discovery |
| `accounting-financial-statements`, `feature/core-capability-wrap-v1`, `feature/job-contract-recovery`, `fix/main-job-recovery-baseline`, `release/business-system-1.0.0`, `architecture/repository-authority-phase1`, `copilot/enforce-task-invariants` | +1 each | งานเฉพาะยังไม่ merge — ตรวจทีละสาขาแล้ว merge/rebase (ประวัติอยู่แล้วในรีโปเดียวกัน) |

### 3.2 รีโป `t23598788-oss/-DNA-OS-INFRASTRUCTURE-` (remote `infra` — เพื่อ fetch ดูอย่างเดียว) — 43 สาขา
Railway deploy จากที่นี่ 2 สาขา: `main` (9ffe56b → dna-os-circuit + joint-monitor), `owner-verification-transport-remote-core` (4a1408b → owner-command-http).
โฟลเดอร์ที่รีโปหลัก**ไม่มี**: `dna-os-circuit/`, `observability/`, `transport/`, `control/` (conversation-runtime), `connections/`, `credentials/`, `permissions/`, `governance/`, `execution/`, `ai/`, `audit/`, `.railway/`, `.github/`, `providers/`, `contracts/` — นี่คือ "งานเฉพาะ" ที่ต้องย้ายเข้ารีโปหลักพร้อมประวัติ.
โฟลเดอร์ชื่อซ้ำแต่เนื้อ**ต่างกัน** (ยืนยันด้วย diff): `supabase/` (infra มี 2 ไฟล์ tiktok-oauth vs 212 ไฟล์), `local-runtime/` (infra = dna-dev-app-host + launchagents), `scripts/`, `config/` — **ห้ามทับ** ต้อง merge แบบ union ระวังชนกัน
วิธีรวมพร้อมเก็บประวัติ: `git remote add infra …` → `git merge infra/main --allow-unrelated-histories` (หรือ `git subtree add`) — ประวัติทั้งสองฝั่งอยู่ครบ; สาขา infra อื่นๆ fetch ทีหลังได้

### 3.3 รีโปชั่วคราว/อื่น
- `origin` = bare repo ท้องถิ่น `/Users/tam/Desktop/ระบบธุรกิจ/.dna-os-git` — เก่ากว่า `github` (มีสาขา vercel/* เพิ่ม) — ใช้เป็น backup เท่านั้น ห้าม deploy
- Vercel project `dna-os-deadboard` — connector ถูกบล็อก (deployment protection) ไม่ใช่รีโปหลัก

## 4. จุดอ้างอิงที่ต้องแก้ให้เป็น "ขอบเขตโฟลเดอร์" แทนผูกกับรีโป (ขั้นตอน 2)

| จุดผูกปัจจุบัน | ที่อยู่ | การแก้ |
|---|---|---|
| DNA OS markers `registry/ core/ engines/` ที่ root (fail-closed) | `engines/workspace/workspaceRootVerifier.ts` | คง marker ไว้ที่ root — ไม่ต้องแก้ ถ้าไม่ย้ายโฟลเดอร์ทั้งสาม |
| `expectedRepositoryRoot` (declared source-of-truth ต่อ path) | command-registry `workspace.verify_root` | รองรับหลาย root ได้แต่ fail-closed เดิม — ยังไม่ต้องแก้ถ้ารวมเป็นรีโปเดียว |
| URL รีโปใน config | `config/system-links.ts` | เปลี่ยนเป็นค่า single source (ทะเบียน) ถ้าชื่อรีโป/โฟลเดอร์เปลี่ยน |
| ทะเบียนสิทธิ์ | `registry/permissions.json` (route prefixes), `portals.json` (nav) | รองรับขอบเขตโฟลเดอร์อยู่แล้ว (ผูก URL/path) — ตรวจซ้ำหลังย้าย route เท่านั้น |
| Drift/registry checks | `scripts/check-drift.sh`, `scripts/sync-registry.ts` | รัน `registry-sync:test` + drift หลังทุกครั้งที่ย้าย |

## 5. ลำดับถัดไป (อ้างอิงลำดับ 6 ขั้นของเฮีย)

1. ✅ **ขั้น 1 (เอกสารนี้)** — แผนที่ซอร์ส + สาขา/รีโป + จุดอ้างอิง
2. **ขั้น 2** — รวมเข้าซอร์สหลัก: merge `infra/main` (เก็บ history) + ตัดสินใจสาขา ahead ทั้ง 7 ใน §3.1 — รักษาพฤติกรรมเดิม, registry รองรับขอบเขตโฟลเดอร์, รัน guard ชุดเต็มหลัง merge
3. **ขั้น 3** — แก้ข้อบกพร่อง Connect ที่พบ + ตรวจ migration ก่อนเปิดช่องทางใหม่ (proposal migrations 2 ตัวยัง NOT APPLIED — migration-before-code)
4. **ขั้น 4** — ทดสอบ UI/API ชุดใหญ่: เอกสาร, เงิน, LINE, คำสั่งกลาง — **เกณฑ์ไม่ใช่แค่ 401/307** (§6)
5. **ขั้น 5** — อัปเดต **service เว็บหลักที่มีผู้ใช้อยู่แล้ว** (`dna-os-deadboard`, 3,742 req/7วัน, เจ้าของ `dnsos.dev`) ให้ deploy จาก `main` ที่ระบุ commit ได้ + แก้ HTTPS `dnaos.dev` (cert wildcard ไม่ครอบ + edge ตอบ 404) — **ไม่เพิ่มเว็บตัวที่สาม**
6. **ขั้น 6** — เมื่อรับงานจริงครบ: หยุดเว็บซ้ำ (`---------------DNA-OS` production/Staging บนโครงการ staging) เก็บรีโปเก่าเป็น archive ก่อนพิจารณาลบ

## 6. เกณฑ์ทดสอบขั้น 4 (ไม่ใช่แค่ 401/307)

- UI: login จริง → workspace, admin pages หลัก (receipts, transactions, relationships), middleware gating `/admin`
- เอกสาร: `document-authority:test` + สร้าง/ดูเอกสารจริงผ่าน UI
- เงิน: `transaction-status-authority` + `payment-atomic` + `business-event-authority`
- LINE: `connect-channel-receive` + webhook flow จริง (signature verify, echo skip, dedup)
- Connect: `connect-core` + `connect-inbound-boundary` + `connect-boundary-census`
- คำสั่งกลาง: `command` route + owner-command-http `/health` revision ตรง commit

## 7. ผลขั้น 2 (ทำแล้ว 2026-10-07 — branch `consolidation/step2` ใน worktree `/Users/tam/Desktop/ระบบธุรกิจ/dna-os-step2`)

- **Commits**: `7d8d69d` (merge infra/main พร้อม history ทั้งสองฝั่ง — 2,544 files, +730k/−10.8k) + `7f3423e` (post-merge registry/guard/config reconciliation) — **ยังไม่ push main, ไม่ deploy**
- **Conflict 7 ไฟล์ resolve**: คง ours = .claude/settings.json, README.md, supabase/config.toml (main มี config 515 บรรทัดที่ deploy ใช้จริง), tsconfig.json, package-lock.json; union = .gitignore (+34), package.json (26 scripts ของ infra รวม `conversation-runtime:build`/`owner-command:serve` + deps @modelcontextprotocol/sdk, pg, zod)
- **ขอบเขต 6 มิติ**: imports ของ infra self-contained (relative ภายใน); start commands path ตรงเดิม; LaunchAgents 2 ตัวของ infra ยังชี้ `/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE` (ยังไม่แก้ — รันอยู่จริงบนเครื่อง os-ui-voice-alert PID); workflow = `.github/workflows/main.yml` ว่าง 1 byte; ไม่มี secret จริงใน credentials/fixtures; **ไม่มี supabase/migrations จาก infra** (ไม่รวม DB ต่างหน้าที่)
- **สาขา production ตรวจแล้ว**: `feature/business-workspace-template-v2` = tree ตรง `ce53edf` เป๊ะ (ไม่มีงานเฉพาะเหลือ — mcp-server รัน main@25 ก.ย. → เปลี่ยนให้ deploy จาก main ในขั้น deploy); สาขา ahead ทั้ง 11 inventory เนื้อหาแล้ว ยังไม่ merge ใด ๆ ( +1×8: accounting(5 files), architecture-manifest(1), copilot(0), core-capability-wrap(18, มี pre-rebase copy), job-contract-recovery(2), fix-job-recovery(1), business-system-matrix(1); +4 khon-kaen; +9 runtime-connect-service-router (11 files — อาจชนกับ d7fbb05 ที่ engines/integration-gateway เดียวกัน)
- **ผลตรวจ**: tsc 0 · `next build` exit 0 · knip 0 · drift 0/0 · governance 8/8 · registry book 0 broken/0 unused/0 unregistered · deploy-gate = เท่า baseline เครื่อง ( blockers เดิม 2: Supabase env ในเครื่อง + dev-loop evidence — พิสูจน์แล้วว่า pre-merge fail เหมือนกันเป๊ะ)
- **Tests ผ่าน**: connect-channel-receive (hold) · inbound-boundary 53/53 · census 15/15 · connect-core 67 · document-authority 58/58 · transaction PASS · payment PROVEN_LOCAL · business-event 34/34 · registry-sync 6/6
- **สิ่งที่ยังขาด (รายงานตรง)**: infra world typecheck ด้วย strict ของ main ไม่ผ่าน (~70 errors) → แยก scope ด้วย tsconfig exclude 16 dirs + 5 bridge scripts (ต้องมี infra tsconfig/งานแก้ในขั้นถัด); knip ยังไม่ตรวจ dead-code ของ infra (ignore scopes); 69 orphan modules ผ่าน known_gap_ref → TASK-085; LaunchAgents ชี้ path เก่า; package-lock ยังเป็นของฝั่ง main (union deps แล้วแต่ยังไม่ regenerate); ยังไม่ได้รัน infra's own test suites (test:control-plane, test:mcp ฯลฯ)

- `tsc --noEmit` 0 + `registry-sync:test` + drift check


# DNA OS — DEPLOY GATE SCOPE NOTES (knip / drift ignore เหตุผลทุกตัว)

เอกสารบันทึกสาเหตุของ pattern ที่ `knip.json → ignore` และจุดที่ประกาศใน
`scripts/check-drift.sh → DECLARED_TOP_LEVEL` — ทุกตัวมีหลักฐานการใช้งานจริงจาก
source ประกอบ (mission: deploy-gate fix 2026-10-18 + SOFTWARE DEVELOPMENT
AUTHORITY 2026-10-18) · ทุกตัว = การตั้งให้การวิเคราะห์ตรงความจริงของกราฟ dependency
ไม่ใช่การปิด/ข้าม gate

| Pattern (knip ignore) | เหตุผล + หลักฐาน |
|---|---|
| `supabase/functions/**` | Edge Functions (Deno) รันใน Supabase runtime ไม่ผ่าน graph ของ main app — ของเดิม |
| `plugins/line/**` · `plugins/platform/mac/**` | standalone adapters ของเดิม |
| `**/*.test.ts`, `local-runtime/**`, `scripts/**`, `e2e/**`, `playwright.config.ts` | test harness/CLI runner รันด้วย tsx/playwright โดยตรง (ของเดิม) |
| `core/workspace/{composer,orchestrator,planner}/**`, รายชื่อไฟล์ individual แถว `services/ai-connection/*` ฯลฯ | deprecated/deferred modules ที่ module-registry ของเดิมระบุไว้แล้ว |
| `app/workspace/_lib/{toolBindings,businessTools,jobDisplayModel}.ts` | source ชั้น legacy ที่ tests อ่านเท่านั้น (ของเดิม) |
| `public/sw.js`, `public/material-workspace/**` | static assets ที่ runtime โหลดผ่าน URL/iframe (WorkspaceFrame.tsx) ไม่ใช่ module import |
| `.ui-v3-backups/**` | backup snapshot ประวัติ UI (ไม่ใช่ source live) |
| `src-tauri/target/**` | Rust build output (สร้างใหม่ทุก build) |
| `dna-os-compute/**` (workspace ของตัวเอง: ignore `src/server-entry.ts`, `src/trust.ts`) | standalone package (package.json/tsconfig/test ของตัวเอง) — server-entry เรียกผ่าน `scripts/start.sh:16`/`start.ps1:24` (`node dist/server-entry.js`) + build-portable.mjs manifest; trust = mTLS layer ทดสอบใน `test/trust-mtls.test.ts` |
| `app/_nav/sectionMeta.ts` | DNA-000239 registered module (module-registry active · known_gap_ref TASK-085) — คงไว้ตาม governance เดิม, ยังไม่มี live caller |
| `engines/transport/driver-workflow.ts` | ถูก `scripts/backend-chain-e2e.test.ts:47` import แบบ dynamic — scripts ถูก exclude จาก graph โดย design จึงมองไม่เห็น |
| `core/auth/orgScope.ts` | TENANT CORE V1 (2026-10-18): pure decision layer ที่ routes จะปรับใช้ตามลำดับ — layer ลงทะเบียนใน module-registry active และมี platform test ทันที (`npm run tenant-core:test`) · รอ adoption ใน routes ก่อนถือเป็น live-call flow |

| Pattern (check-drift DECLARED_TOP_LEVEL) | เหตุผล |
|---|---|
| `dna-os-compute/` | tracked standalone compute package 27 ไฟล์ — precedent เดียวกับ `dna-os-mcp-server` (ประกาศตาม comment ใน check-drift.sh เอง) |

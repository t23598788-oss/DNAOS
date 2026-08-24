# governance/release-gate/ — Round 1: real, narrow Release Authority (never live deploy)

**หน้าที่ (เต็ม, เป้าหมายสุดท้าย):** ด่านสุดท้ายก่อนปล่อยงาน — ตรวจว่า
`../source-validation/`, `../dependency-rules/`, `../permission-rules/`
ผ่านหมดแล้ว ก่อนอนุญาตให้ `../../execution/deploy/` ทำงานจริง

**สถานะรอบนี้ (2026-08-21, Multi-Agent Production Control STEP):**
`./resolver.ts`'s `decideRelease()` เป็น Release Authority จริงสำหรับ
สาย Multi-Agent Production เท่านั้น — ตรวจ (1) real
`post_commit_verification` evidence ที่มีอยู่แล้ว (อ่านเท่านั้น ไม่เรียก
`runPostCommitVerification` ซ้ำ — กัน recursive `npm run test:integration`),
(2) dependency staleness จริง (re-read `findCapability` สด), (3) required
evidence files มีจริง คืนผลแค่
`RELEASE_ELIGIBLE | RELEASE_BLOCKED | RELEASE_UNRESOLVED` พร้อมเหตุผล
เสมอ **ยังไม่เรียก** `../source-validation/`, `../dependency-rules/`,
`../permission-rules/` เพราะทั้งสามยังเป็น `NOT_YET_BUILT` จริง (rule
เขียนไว้ ยังไม่มี checker) — ห้าม fabricate การเรียก **ยังไม่แตะ**
`../../execution/deploy/`/Vercel เด็ดขาด (ขอบเขตเดิมด้านล่างยังคงล็อก
เหมือนเดิมทุกประการ)

**Input:** `ReleaseAuthorityInput` (real, จาก
`control/duplicate-reservation/`/`control/work-coordination/`'s สาย
Multi-Agent Production)

**Output:** `ReleaseAuthorityResult` — อนุญาต/ปฏิเสธพร้อมเหตุผลเสมอ
(ไม่ใช่ boolean เปล่า — เหมือนหลักการเดียวกับ
`../../contracts/command/routing-result.ts`'s `RoutingResult`)

**Dependency ที่อนุญาต (รอบนี้):**
`../../control/agent-gateway/contract.ts` (`loadEvidenceForTask` อ่าน
เท่านั้น), `../../software/registry-database/contract.ts`
(`findCapability` อ่านเท่านั้น), `../../execution/process-lock/contract.ts`,
`./types.ts`, `./host-runtime.ts` — governance subfolder อื่น +
`../../execution/test/` + `../../connections/vercel/` (เป้าหมายสุดท้าย)
ยังไม่ผูกจนกว่าจะมี implementation จริง

**สิ่งที่ห้ามแตะ:** ห้ามให้ `../../execution/deploy/` ข้ามด่านนี้ไม่ว่า
กรณีใด รวมถึงคำสั่งจาก Owner เอง ห้ามเรียก
`control/post-commit-verification/`'s `runPostCommitVerification` จาก
ที่นี่ — อ่าน evidence ที่มีอยู่แล้วเท่านั้น ห้าม RELEASE_ELIGIBLE โดยไม่มี
real VERIFIED evidence ห้าม silently release ด้วย dependency state
คนละชุดกับตอน build/test

## ขอบเขตเพิ่มเติมสำหรับ Vercel Checks (Owner, 2026-08-14 — boundary planned, ยังไม่สร้างจริง)

โฟลเดอร์นี้เป็นเจ้าของ **การตัดสินใจ** ว่า Vercel Check ที่ผูกกับ
`blocks: "deployment-alias"` หรือ `"deployment-promotion"` ควรได้ผลลัพธ์
`succeeded`/`failed`/`neutral` — ส่วนการเรียก
`PATCH .../check-runs/{id}` จริงไปหา Vercel ต้องผ่าน
`../../connections/vercel/`'s contract เท่านั้น **ห้ามเรียก HTTP ตรงจาก
โฟลเดอร์นี้เด็ดขาด** เดียวกับกฎ `contracts/` → `permissions/` ทางเดียวใน
root README: โฟลเดอร์นี้พึ่ง `../../connections/vercel/` ได้
`../../connections/vercel/` ห้ามพึ่งโฟลเดอร์นี้กลับ

**ล็อกไว้จนกว่าจะพิสูจน์ได้:** ไม่มี Checks-write capability ใดถูกสร้างจน
`../../connections/vercel/CHECKS_API_LIVE_TEST_PLAN.md`'s test รันจริงและ
รู้ผลจริงว่า project-scoped token พอหรือไม่ (ดู
[`../architecture-rules/VERCEL_BOUNDARY_PLAN.md`](../architecture-rules/VERCEL_BOUNDARY_PLAN.md)
Rule 4) — ถ้าคำตอบคือ "ต้องเป็น OAuth2 Integration" การ report กลับ Vercel
ต้องรอ capability ใหม่ที่ยังไม่มีวันนี้

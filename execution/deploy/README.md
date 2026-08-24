# execution/deploy/ — Round 1: PLAN/GATE layer only (real, no live deploy)

**หน้าที่ (เต็ม, เป้าหมายสุดท้าย):** Deploy Software ที่ build+test ผ่าน
แล้ว ผ่าน adapter ที่เกี่ยวข้องใน `../../connections/` (เช่น Vercel)

**สถานะรอบนี้ (2026-08-21, control/external-system-lifecycle/'s STEP):**
`./resolver.ts`'s `resolveDeployPlan()` เป็นชั้น PLAN/GATE เท่านั้น — ตรวจ
ว่า deploy ควรทำได้หรือไม่ โดยไม่เคย deploy จริง `IN_PROCESS_LOCAL`
resolve เป็น `NOT_APPLICABLE` เสมอ (ไม่มี deploy step แยกสำหรับ library ที่
co-located อยู่แล้ว) ทุก class อื่น resolve เป็น `BLOCKED` เสมอ เพราะ
`../../governance/release-gate/` ยังไม่มี implementation จริง (และสำหรับ
HOSTED_SERVICE `../../connections/vercel/` ยัง Owner-lock อยู่ — ดู
`../../connections/vercel/README.md`) `./resolver.ts` ไม่ import ทั้งสอง
โฟลเดอร์นี้เลย อ้างอิงแค่ path README ของทั้งสองเป็นเหตุผลเท่านั้น

**Input:** `DeployPlanInput` (capability_id + delivery_target_class จาก
`../../control/external-system-lifecycle/`) — ยังไม่ใช่ `CommandEnvelope`
เต็มรูปแบบตามเป้าหมายสุดท้าย (deferred)

**Output:** `DeployPlanResult` — `BLOCKED | NOT_APPLICABLE` เท่านั้น รอบ
นี้ยังไม่มี status ใดสื่อว่า deploy จริงเกิดขึ้น

**Dependency ที่อนุญาต:** `./types.ts`, `./host-runtime.ts`

**สิ่งที่ห้ามแตะ:** ห้าม import `../../connections/vercel/` หรือ
`../../governance/release-gate/` เด็ดขาด — ทั้งสองยังไม่มี source ตาม
Owner lock ปัจจุบัน ห้ามเพิ่ม status ใดที่บอกว่า deploy เกิดขึ้นจริงจนกว่า
ทั้งสอง dependency นี้จะมี implementation จริง

# control/source-workspace/

**หน้าที่:** SOURCE WORKSPACE ISOLATION จริง ผ่าน `git worktree` local
จริง — สอง Agent เขียนไฟล์บน repository เดียวกันพร้อมกัน จะได้ working
directory จริงคนละอัน + local branch จริงคนละอัน ไม่ overwrite กัน
`branch_ref`/`worktree_path` derive จาก `work_id` เสมอ Agent เลือกเองไม่ได้

**Discovery ก่อนสร้าง (2026-08-21):** ตรวจแล้วว่าไม่มี branch/worktree
capability จริงอยู่ก่อน — `connections/github/write-api.ts` มีแค่
create-or-update-file เดียว (ไม่มี ref/branch creation, ยืนยันจาก source
จริง) เส้นทาง remote GitHub branch creation **BLOCKED จริง** ด้วย Owner
lock 2 จุดแยกกัน (ยังไม่แตะทั้งคู่รอบนี้):
1. `execution/run/contract.ts` — "HARD BLOCK (Owner, 2026-08-16): no file
   under `control/`... imports from this file yet"
2. `connections/github/host-runtime.ts` — `hostFetch` ล็อก GET-only
   ตลอดไป, `hostFetchWrite` ล็อก PUT-only "ห้ามเพิ่ม parameter method หรือ
   body เข้า hostFetch เด็ดขาด... never DELETE, never an arbitrary method"

เส้นทางที่ใช้ได้จริงและไม่ชน lock ใดเลย: **local git worktree** ผ่าน
`execFile("git", ...)` ตรงๆ — เส้นทางเดียวกับที่
`connections/connection-registry/git-discovery.ts` ใช้จริงอยู่แล้ว (ไม่
ผ่าน `execution/run/`, ไม่ผ่าน `connections/github/`'s HTTP layer เลย)

**Input:** `CreateWorkspaceInput` (work_id, repository_id,
repository_root, base_branch)

**Output:** `CreateWorkspaceResult` — `WorkspaceReservation` จริง
(branch_ref, worktree_path, base_commit_sha จริงจาก `git rev-parse`)

**Dependency ที่อนุญาต:** `./types.ts`, `./host-runtime.ts`

**สิ่งที่ห้ามแตะ:** ห้ามให้ caller เลือก `branch_ref`/`worktree_path` เอง
— derive จาก `work_id` เสมอ ห้ามเรียก GitHub remote API จากที่นี่ — local
`git` เท่านั้น ห้ามแก้ `execution/run/contract.ts`'s hard block หรือ
`connections/github/host-runtime.ts`'s GET/PUT-only lock — ทั้งสองยัง
ล็อกอยู่จริง ไม่ใช่หน้าที่ของโฟลเดอร์นี้จะเปลี่ยน

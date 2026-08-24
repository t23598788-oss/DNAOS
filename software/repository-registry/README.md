# software/repository-registry/

**หน้าที่:** ทะเบียน Git Repository ที่ระบบควบคุมนี้รู้จัก — เช่น
`dna-os-deadboard`, `DNA-OS-INFRASTRUCTURE` เอง เก็บแค่ identity/reference
(`owner`, `repository`, `world`, `source_authority` = git remote URL จริง,
`default_branch`, `repository_root`, `connection_id` reference,
`status`) — **ไม่เก็บ source code ของ repo อื่นไว้ที่นี่ ไม่เก็บ
credential**

**Input:** `RegisterRepositoryInput`

**Output:** `RepositoryRegistration` — real, durable (append-only JSONL,
`software/repository-registry/data/repositories.jsonl`, latest-per-`repository_id`
wins, restart-safe — same convention as
`connections/connection-registry/registry.ts`)

**Dependency ที่อนุญาต:** `../registry-database/` (repository มักผูกกับ
Software/Capability หนึ่งตัว), `../../connections/connection-registry/contract.ts`
(`discoverGitRemote` — reused, never reimplemented, for real local git
discovery)

**สิ่งที่ห้ามแตะ:** ห้ามเก็บ credential ของ repo ไว้ในไฟล์นี้ —
credential reference อยู่ใน `connection_id` (ชี้ไปยัง
`connections/connection-registry/` เท่านั้น) ห้าม fabricate registration
ของ repo ที่พิสูจน์ไม่ได้จริง (ต้องมี real git remote หรือหลักฐาน
เทียบเท่า) ห้ามเพิ่ม `allowed_capability_class`/`forbidden_asset_class`
โดยไม่มี consumer จริงในปัจจุบัน (G-ARCH-002) — omitted deliberately this
round

**สถานะ (2026-08-21, Multi-Agent Production Control STEP):** REAL, filled
existing reserved boundary — ไม่ใช่ registry ตัวที่สอง `buildRepositoryId`
deterministic เหมือน `connections/connection-registry/`'s
`buildConnectionId` — re-register repo เดิมซ้ำ = idempotent

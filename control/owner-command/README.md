# control/owner-command/

**หน้าที่:** รับคำสั่งที่มาจาก Owner โดยเฉพาะ — เป็นทางเข้าพิเศษหนึ่ง
เส้นทาง ไม่ใช่ทางลัดข้าม authorization. สร้าง `CommandEnvelope`
(`issued_by.kind = "human"`), ส่งต่อให้ `../command-router/` เท่านั้น,
ติดตาม `CommandLifecycleState` (`../command-status/lifecycle.ts`), และ
render ผลลัพธ์กลับให้ Owner เห็นเป็น "งานเดียว" เสมอ ไม่ว่าจะใช้กี่
capability ข้างในก็ตาม.

**Status (2026-08-16):** built and tested. `submitOwnerCommand` drives
the full real flow: Owner text → `CommandEnvelope` →
`../command-router/contract.ts`'s `routeOwnerCommand` →
`CapabilityResult` → `CommandLifecycleState` → `OwnerSurfaceState`. No
transport (CLI/HTTP) wires real Owner input into this yet — this repo
builds no server/dashboard app (see root `README.md`).

**Input:** Owner command text (a string) + the Owner's `EnvelopeIdentity`
(`../../contracts/identity/envelope-identity.ts`, `kind: "human"` —
asserted here, rejected otherwise).

**Output:** `SubmitOwnerCommandOutcome` — the `CommandEnvelope` built,
the `CommandLifecycleState`, the `CapabilityResult`, and the rendered
`OwnerSurfaceState` (Current Command, Current Worker, Current Status,
Progress, Result, Evidence, Warnings, Available Capabilities).
`renderOwnerSurface()` turns that state into a plain formatted string —
not a UI component; this repo has no framework/server dependency to
render one (see root `README.md`, `../../governance/architecture-rules/`).

**Dependency ที่อนุญาต:** `../../contracts/command/`,
`../../contracts/identity/envelope-identity.ts`,
`../command-router/contract.ts`, `../command-status/lifecycle.ts`,
`./types.ts`, `./host-runtime.ts`.

**สิ่งที่ห้ามแตะ:**
- ห้ามสร้าง path ที่ให้ Owner สั่งงานโดยไม่ผ่าน `../command-router/` —
  จะกลายเป็นการข้าม authorization boundary ทันที (`submitOwnerCommand`
  has exactly one call into `../command-router/contract.ts` and no other
  path to any capability)
- ห้าม scan file, ห้าม reason เรื่อง permission เอง, ห้ามรัน shell
  command, ห้ามต่อ business DB ตรงๆ — ทุกอย่างนั้นเป็นหน้าที่ของ
  capability ที่ถูก route ไปเท่านั้น
- ห้ามยอมรับ `issued_by.kind` อื่นนอกจาก `"human"` — `submitOwnerCommand`
  throws otherwise, tested in `./tests/owner-command.test.ts`
- ห้าม expose source code หรือ path ของ repo อื่นใน `OwnerSurfaceState`
  โดย default (ดู `./types.ts`'s header)

**Files:**
- `types.ts` — `OwnerSurfaceState`, `OwnerCapabilityStatus`.
- `owner-command.ts` — `submitOwnerCommand`, `previewOwnerCommand`,
  `renderOwnerSurface`, the lifecycle-derivation logic. Private
  (implementation).
- `host-runtime.ts` — `crypto.randomUUID`/`Date` ambient. Private.
- `contract.ts` — the ONLY file any future transport should import from.
- `tests/owner-command.test.ts` — drives `contract.ts` directly,
  exercises the full real flow end to end (real permission decision, real
  `execution/run/` spawn, real lifecycle transitions per
  `../command-status/lifecycle.ts`'s `LEGAL_TRANSITIONS`).

See `./ARCHITECTURE_DECISIONS.md` for the lifecycle-mapping rules.

# connections/github/ — BUILT (read-only: connect / test / read status)

**หน้าที่:** adapter สำหรับเชื่อมต่อ GitHub — เก็บ source code ของตัวเชื่อม
(auth, เรียก GitHub API) เท่านั้น ไม่เก็บเนื้อหา repo ที่เชื่อมถึง

**ขอบเขตรอบนี้ (Owner, 2026-08-14):** เชื่อมต่อ / ทดสอบการเข้าถึง /
อ่านสถานะ repository **เท่านั้น** — ยังไม่มี push/write/commit ใดๆ
(ดู "ยังไม่ได้สร้าง" ท้ายไฟล์ และ `POLICY.md` ข้อ P-GH-001)

**Input:** `CommandEnvelope` ที่ route มาจาก
`../../control/command-router/` พร้อม intent เกี่ยวกับ GitHub
— intent ที่รองรับจริงตอนนี้: `connector.github.check_access`,
`connector.github.read_status`

**Output:** `EventEnvelope` — `connector.github.access_checked` หรือ
`connector.github.status_read` — หรือ rejection รูป `RoutingResult`
(`ok:false` พร้อม `reason` + `denied_at_stage`) เมื่อ command ไม่ผ่าน

**Dependency ที่อนุญาต:** `../../contracts/connector/connection.ts`,
`../../contracts/command/command-envelope.ts`,
`../../contracts/command/routing-result.ts`,
`../../contracts/event/event-envelope.ts`,
`../../contracts/identity/envelope-identity.ts` (เฉพาะใน test),
`../../config/connection-settings/` (รูปแบบ ไม่ใช่โค้ด — ดูหมายเหตุ)

**สิ่งที่ห้ามแตะ:** credential ต้องอ่านจาก **`GITHUB_PAT_INFRASTRUCTURE`
เพียงชื่อเดียว** (Owner, 2026-08-14 — ไม่รับชื่อ env var อื่นอีกต่อไป แม้
`credential_ref` จะระบุมา, ดู P-GH-013), ห้าม hardcode token ในไฟล์ใดใน
โฟลเดอร์นี้เด็ดขาด, **ห้าม fallback ไป git credential helper หรือ macOS
Keychain ไม่ว่ากรณีใด** (โฟลเดอร์นี้ไม่เรียก `git`/keychain เลย — ยืนยัน
ด้วยการตรวจโค้ดจริง), ห้ามเขียนอะไรกลับไปที่ GitHub, ห้ามเขียนไฟล์ลงดิสก์
ของเครื่อง, ห้ามให้ผลลัพธ์ถือเนื้อหาไฟล์หรือข้อมูลธุรกิจ — กฎเต็มพร้อม
"บังคับด้วยอะไร" อยู่ที่ [`POLICY.md`](POLICY.md)

---

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `adapter-contract.ts` | contract | intent / payload / result / outcome ของ adapter นี้เอง |
| `adapter-config.ts` | config | ค่าไม่ลับ: base URL, API version, timeout, เพดานจำนวน path |
| `host-runtime.ts` | source | ประกาศ host API เท่าที่ใช้ (`process.env`, `fetch` แบบ GET-only, `crypto`, `console`) |
| `credential-resolution.ts` | source | resolve token จาก `process.env[credential_ref.name]` |
| `repo-path.ts` | source | ตรวจและ encode path ใน repo (กัน `..`, `/`, `.git`, control char) |
| `github-read-api.ts` | source | เรียก GitHub REST จริง — GET อย่างเดียว (repo / branch / path metadata) |
| `payload-validation.ts` | source | ตรวจ `CommandEnvelope.payload` (typed `unknown`) ให้กลายเป็น payload ที่มีชนิดจริง |
| `status-operations.ts` | source | `checkRepoAccess` + `readRepositoryStatus` |
| `github-adapter.ts` | source | **ทางเข้าเดียว** — `handleGithubCommand(CommandEnvelope)` |
| `adapter.test.ts` | test | test จริง รันได้เป็นโฟลเดอร์เดียว (offline + live) |
| `POLICY.md` | policy | กฎ 13 ข้อของ adapter นี้ พร้อมสิ่งที่บังคับกฎแต่ละข้อ |
| `CHANGE_PLAN_API_VERSION.md` | plan | แผนเปลี่ยน `GITHUB_API_VERSION` 2022-11-28 → 2026-03-10 — **ยังไม่เปลี่ยนจริง**, รอ Owner อนุมัติ |
| `ARCHITECTURE_DECISIONS.md` | ADR | ADR-GH-001: PAT = bootstrap credential วันนี้, GitHub App = target architecture เมื่อถึง trigger condition |
| `README.md` | doc | ไฟล์นี้ |

## วิธีรัน test

ไม่มี test framework และไม่มี `package.json` ใน repo นี้ — `adapter.test.ts`
เป็นโปรแกรมที่มี assertion ของตัวเอง รันตรงได้เลย:

```
# offline suite เท่านั้น (ไม่ต้องมี credential) — จบด้วย exit code 2 = ยังไม่ได้ verify ของจริง
npx tsx connections/github/adapter.test.ts

# offline + live suite ของจริง
GITHUB_PAT_INFRASTRUCTURE=<ค่า> npx tsx connections/github/adapter.test.ts

# ชี้ไปที่ repo อื่น (ค่า default คือ t23598788-oss/-DNA-OS-INFRASTRUCTURE-)
GITHUB_ADAPTER_TEST_REPO=<repo> GITHUB_PAT_INFRASTRUCTURE=<ค่า> npx tsx connections/github/adapter.test.ts
```

exit code: `0` = ผ่านและ verify ของจริงแล้ว, `1` = มี test fail จริง,
`2` = ไม่มี credential เลยข้าม live suite (**ยังไม่ verify**), `3` =
credential เข้าถึง repo ที่ตั้งไว้ไม่ได้ (**ยังไม่ verify**)

## หลักฐานการทดสอบจริง (2026-08-14, รันจริง ไม่ใช่การคาดการณ์)

| การตรวจ | ผล |
|---|---|
| `tsc --noEmit -p tsconfig.json` (tsconfig ของ repo นี้เอง) | **PASS** — exit 0, ไม่มี error |
| Offline suite (14 checks) | **PASS** — 14/14 |
| Live suite กับ `t23598788-oss/camo` (repo จริง, credential จริง) | **PASS** — รวม 20/20, exit 0 |
| Live suite กับ `t23598788-oss/-DNA-OS-INFRASTRUCTURE-` | **BLOCKED** — exit 3, HTTP 404 (ดูด้านล่าง) |

สิ่งที่ live suite เห็นจริงจาก `t23598788-oss/camo`:
`default_branch=master`, `visibility=public`,
`head_commit_sha=e59df56a01c023850962fac16905269d264fba50` (2017-09-09T21:19:17Z),
root มี 20 entries, `.gitignore` → file 59 bytes sha `3d8b93b3…`,
`log` → directory 1 entry, `no/such/path/here.md` → absent, branch ที่ไม่มี
จริง → `branch_found=false`

### ข้อค้นพบจริง: credential ตัวนี้ยังเข้าถึง `-DNA-OS-INFRASTRUCTURE-` ไม่ได้

`GITHUB_PAT_INFRASTRUCTURE` เป็น token ที่ **ใช้งานได้จริง** (GitHub ตอบ
200 ที่ `/user`) แต่ตอบ **HTTP 404** ที่
`/repos/t23598788-oss/-DNA-OS-INFRASTRUCTURE-` และ repo เดียวที่ token นี้
มองเห็นคือ `t23598788-oss/camo` — เป็น fine-grained PAT ที่ยังไม่ได้เลือก
repo `-DNA-OS-INFRASTRUCTURE-` ไว้ใน repository access

`git push` ที่สำเร็จใน session นี้ **ไม่ได้พิสูจน์ว่า token ตัวนี้เข้าถึง
ได้** — git ใช้ credential คนละตัว (credential helper ของเครื่อง) ไม่ใช่
env var ตัวนี้ นี่คือรูปแบบเดียวกับที่ TASK-172 เจอจริงเมื่อ 2026-08-14

**นี่ไม่ใช่ข้อบกพร่องของ adapter** — adapter รายงานสถานะนี้ถูกต้องตามจริง
และรายงานความกำกวมของ 404 ตามที่มันเป็น การแก้คือ Owner ไปเพิ่ม repository
access ให้ PAT ตัวนี้ใน GitHub settings แล้วรัน test ซ้ำ (ค่า default ของ
test ชี้ไปที่ repo นี้อยู่แล้ว จะกลายเป็น PASS ทันทีที่สิทธิ์ถูกเปิด)

## ยังไม่ได้สร้าง (NOT_YET_BUILT — ระบุไว้ ไม่ใช่ละไว้เงียบๆ)

- **push / write / commit** — Owner สั่งเลื่อนไปรอบถัดไป (2026-08-14) ไม่มี
  intent, ไม่มี type, ไม่มี code path ใดในโฟลเดอร์นี้ที่เขียนกลับไป GitHub ได้
- **อ่านเนื้อหาไฟล์ (pull)** — รอบนี้อ่านได้แค่ metadata ของ path
  (type, blob sha, ขนาด) ไม่อ่านเนื้อหา
- **directory แบบ recursive** — path ที่เป็น directory รายงานเฉพาะ entry
  ชั้นแรก ไม่ไล่ลงไปในโฟลเดอร์ย่อย
- **webhook / event ขาเข้าจาก GitHub**
- **การส่ง EventEnvelope ออกไปจริง** — `handleGithubCommand` **คืน**
  EventEnvelope ให้ผู้เรียก แต่ยังไม่มีใครรับ: `../../control/command-router/`
  ยังไม่มีจริง และ `../../contracts/operational-bridge/` ยังไม่มี transport
  จริง (README เดิมของโฟลเดอร์นี้เขียนว่า Output ส่ง "กลับผ่าน
  operational-bridge" — แก้เป็นข้อความปัจจุบันเพราะ bridge ยังส่งอะไรไม่ได้
  จริง การเขียนว่าส่งได้จะเป็นการอ้างสิ่งที่ยังไม่มี)
- **`connection.status` ไม่ถูกใช้เป็นเงื่อนไข** — ยังไม่มีใครใน repo นี้
  เป็นเจ้าของการเปลี่ยนสถานะนั้น (เหตุผลเต็มอยู่ท้าย `github-adapter.ts`)

## หมายเหตุการแก้ README เดิมโดยตั้งใจ (ไม่ใช่ drift)

1. **Output** เดิมเขียนตัวอย่างว่า `"sync.completed"` — รอบนี้ไม่มี sync
   จริง event ที่ออกจริงคือ `connector.github.access_checked` และ
   `connector.github.status_read` และเพิ่ม rejection รูป `RoutingResult`
   ซึ่ง README เดิมไม่ได้พูดถึงเลย
2. **Dependency ที่อนุญาต** เดิมมีแค่ `contracts/connector/connection.ts`
   กับ `config/connection-settings/` — แต่ boundary จริงของ adapter คือ
   `CommandEnvelope` เข้า / `EventEnvelope` ออก จึงต้องพึ่ง
   `contracts/command/` และ `contracts/event/` ด้วย (และ
   `contracts/identity/` ที่ test ใช้สร้าง envelope) จึงเพิ่มเข้าไปตามของจริง
3. **`config/connection-settings/`** ยัง NOT_YET_BUILT และไม่มี source ให้
   import — ที่นำมาใช้จริงคือ *รูปแบบ* ที่มันกับ `config/environment/`
   ประกาศไว้ ส่วนค่าไม่ลับจริงอยู่ที่ `adapter-config.ts` ในโฟลเดอร์นี้
   ตาม Capability Folder Law ข้อ 3/7 (config ของความสามารถอยู่กับความสามารถ)
4. **บริบท TASK-172** ยังเป็นจริงทุกข้อ (freeze เป็น legacy ที่ repo นั้น
   ไม่ได้ย้ายมา) โค้ดในโฟลเดอร์นี้เขียนใหม่ทั้งหมดตาม contract ของ repo นี้
   ไม่มี import ข้าม repo และไม่มี dependency กลับไปหา repo นั้น

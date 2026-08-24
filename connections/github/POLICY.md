# connections/github/ — Adapter Policy

**status: บังคับใช้กับโค้ดทุกไฟล์ในโฟลเดอร์นี้**
**ขอบเขตรอบนี้ (Owner, 2026-08-14): CONNECT / TEST / READ STATUS เท่านั้น**
**credential ช่องทางเดียว (Owner, 2026-08-14): `GITHUB_PAT_INFRASTRUCTURE` เท่านั้น — ดู P-GH-013**

กฎด้านล่างคือสิ่งที่ adapter ตัวนี้ทำและไม่ทำ — ไม่ใช่ความตั้งใจ แต่เป็น
สิ่งที่บังคับไว้ในโครงสร้างของโค้ดจริง แต่ละข้อระบุไว้ว่าบังคับด้วยอะไร

---

## P-GH-001 — อ่านอย่างเดียว (read-only) โดยโครงสร้าง

Adapter นี้ **ไม่เขียนอะไรกลับไปที่ GitHub เลย** ไม่ใช่แค่ "ยังไม่ได้ทำ"
แต่ไม่มีทางเรียกได้: `host-runtime.ts`'s `hostFetch` ไม่มี parameter
`method` และไม่มี parameter `body` — และ `fetch` ที่ไม่ระบุ method คือ GET
เสมอ ทุก request ในโฟลเดอร์นี้ผ่าน `github-read-api.ts`'s `githubGet`
ทางเดียว

**บังคับด้วย:** signature ของ `hostFetch`
**การเพิ่ม push/write ต้องเป็นรอบงานใหม่ที่ Owner อนุมัติ** ห้ามเพิ่มเอง

## P-GH-002 — ไม่เขียนไฟล์ลงดิสก์ของเครื่อง

ไม่มีไฟล์ใดในโฟลเดอร์นี้ import `fs`/`node:fs` และไม่มีฟังก์ชันใดเขียนลง
ดิสก์ การ pull เนื้อหาไฟล์มาทับไฟล์ในเครื่องคือการกระทำที่ย้อนกลับยาก —
ต้องเป็นการตัดสินใจของคนทุกครั้ง ไม่ใช่ผลข้างเคียงของ command

**บังคับด้วย:** ไม่มี filesystem import ในโฟลเดอร์นี้เลย

## P-GH-003 — ปฏิเสธการทำงานถ้าไม่มี credential ที่ resolve ได้

ถ้า `credential_ref` ไม่ใช่ `env_var` หรือ env var นั้นไม่ถูกตั้งค่า/ว่าง →
คืน rejection (`denied_at_stage: "authenticate"`) **ไม่มี fallback ไปเป็น
request แบบไม่ล็อกอิน** — request แบบไม่ล็อกอินยังอ่าน public repo ได้
ซึ่งจะทำให้ connection ที่พังดู "ปกติ" นั่นคือความล้มเหลวแบบเงียบที่ห้าม
เกิดขึ้น

**บังคับด้วย:** `credential-resolution.ts` + ลำดับใน `github-adapter.ts`

## P-GH-004 — credential เดินทางด้วย "ชื่อ" เท่านั้น ค่าจริงไม่ออกจาก process

ค่า token อ่านจาก `process.env[EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME]`
ตอนใช้งานเท่านั้น อยู่ใน Authorization header อย่างเดียว **ห้ามปรากฏใน
reason, event, log, URL, หรือ return value ใดๆ** สิ่งที่บันทึกลง event คือ
`credential_source` รูปแบบ `env:<NAME>` ซึ่งไม่ใช่ความลับ และทำให้ตรวจสอบ
ย้อนหลังได้ว่าใช้ credential ตัวไหน — rotate credential = เปลี่ยนค่าใน env
var ไม่ต้องแก้ source

**บังคับด้วย:** `credential-resolution.ts` + assertion จริงใน
`adapter.test.ts` ที่ตรวจว่า serialized event ไม่มี substring ของ token
แต่มี `credential_source` ที่ถูกต้อง — ดูเพิ่ม P-GH-013

## P-GH-005 — Command ใช้ได้เฉพาะ connection ของ Account ตัวเอง

`connection.account_id` ต้องเท่ากับ `command.issued_by.acting_as_account_id`
ไม่งั้นปฏิเสธที่ stage `"authorize"` **ก่อน** อ่าน credential และ **ก่อน**
ยิง network ใดๆ — ตรงตามกฎใน `../../contracts/command/command-envelope.ts`
("the only account a Command may affect is issued_by.acting_as_account_id")

นี่คือสิ่งที่ TASK-172 (dna-os-deadboard) ทำไม่ได้ และเป็นเหตุผลที่มันถูก
freeze เป็น legacy

**บังคับด้วย:** `authorizeConnectionScope()` ใน `github-adapter.ts`

## P-GH-006 — ไม่มีค่า default ของ repo/branch ใดๆ

owner / repo / branch มาจาก payload ของ Command เสมอ ไม่มีค่า default ใน
โค้ด ไม่มีการเดา `"main"` — Command ที่ไม่ระบุ branch ถูกปฏิเสธ ไม่ใช่ถูก
เดาให้ (adapter ตัวนี้ต้องใช้ได้กับทุก repo ไม่ผูกกับ repo ใด repo หนึ่ง
แม้แต่ repo ของตัวเอง)

**บังคับด้วย:** `payload-validation.ts` + ไม่มีค่า repo/branch ใน
`adapter-config.ts`

## P-GH-007 — path ที่รับมาต้องผ่านการตรวจก่อนกลายเป็น URL

ปฏิเสธ path ที่ขึ้นต้นด้วย `/`, มี `..` หรือ `.`, มี segment ว่าง, มี
backslash, มี control character, ชี้เข้า `.git`, หรือยาวเกินขีดจำกัด และ
encode ทีละ segment (ไม่ทำลาย `/`)

**บังคับด้วย:** `repo-path.ts` (มี test ครบทุกกรณีข้างต้น)

## P-GH-008 — ไม่มีความล้มเหลวแบบเงียบ

ทุกความล้มเหลวคืนออกมาเป็นข้อมูลพร้อมเหตุผล ไม่ throw ทิ้ง ไม่ catch แล้ว
กลืน และแยกได้จริงระหว่าง "ไม่มี HTTP response เลย" (`http_status: null`,
network/DNS/TLS/timeout) กับ HTTP 401 / 403 / 404 / อื่นๆ

**บังคับด้วย:** discriminated union return type ทุกตัวใน
`github-read-api.ts`

## P-GH-009 — HTTP 404 ไม่ได้แปลว่า "repo ไม่มีอยู่จริง"

GitHub ตอบ 404 ทั้งกรณี repo ไม่มีจริง และกรณี token มองไม่เห็น repo นั้น
(fine-grained PAT ที่ยังไม่ได้เลือก repo นี้) adapter รายงานความกำกวมนี้
ตามจริง **ห้ามเดาแทนผู้ใช้** — ยืนยันด้วยของจริงแล้ว 2026-08-14
(ดู README.md ส่วน "หลักฐานการทดสอบจริง")

**บังคับด้วย:** ข้อความใน `getRepository()` + test จริงที่ assert ข้อความนี้

## P-GH-010 — ไม่มีข้อมูลธุรกิจ ไม่มีเนื้อหาไฟล์

ผลลัพธ์ของ adapter นี้เป็น metadata ของ source control เท่านั้น: path,
blob sha, ขนาดไฟล์, commit sha, เวลา commit, HTTP status, ชื่อ branch
**ไม่มี type ใดในโฟลเดอร์นี้ที่เก็บเนื้อหาไฟล์ได้** แม้ GitHub จะแนบ
`content` มาให้ใน response ก็ตัดทิ้ง — type ที่เก็บเนื้อหาไม่ได้ ทำให้
เนื้อหารั่วไม่ได้ ตรงตาม `../../contracts/operational-bridge/bridge.ts`
และกฎ "repo นี้ห้ามถือข้อมูลธุรกิจ" ใน `../../README.md`

**บังคับด้วย:** `GithubPathStatus` ใน `adapter-contract.ts` ไม่มี field
เนื้อหา + `getPathStatus()` ไม่อ่าน field `content`

## P-GH-011 — จำนวน request ต่อหนึ่ง Command มีเพดาน

หนึ่ง read-status command ถาม path ได้ไม่เกิน `MAX_STATUS_PATHS_PER_COMMAND`
(50) และเรียกทีละอันตามลำดับ ไม่ยิงขนานเป็นชุด — Command เดียวต้องกลาย
เป็น API call ไม่จำกัดไม่ได้ ทุก request มี timeout 30 วินาที และ **ไม่มี
auto-retry เมื่อโดน rate limit** (429 รายงานตามจริง ไม่ retry เงียบๆ)

**บังคับด้วย:** `adapter-config.ts` + loop ใน `status-operations.ts`

## P-GH-012 — ทางเข้าเดียวคือ `handleGithubCommand`

Capability อื่นเรียก adapter นี้ผ่าน `github-adapter.ts`'s
`handleGithubCommand(CommandEnvelope)` เท่านั้น ห้าม import ไฟล์ภายในอื่น
ของโฟลเดอร์นี้จากนอกโฟลเดอร์ และโฟลเดอร์นี้ห้าม import จาก capability
folder อื่น (import ได้เฉพาะ `../../contracts/`) — Capability Folder Law
ข้อ 8, 9

**บังคับด้วย:** import ที่มีจริงในทุกไฟล์ (ตรวจได้ด้วยการอ่าน import
statement ทั้งโฟลเดอร์)

## P-GH-013 — Credential ต้องมาจาก `GITHUB_PAT_INFRASTRUCTURE` เท่านั้น ห้ามมีช่องทางที่สอง (Owner, 2026-08-14)

`connection.credential_ref.name` ต้องเท่ากับ
`EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME` (`"GITHUB_PAT_INFRASTRUCTURE"`)
เป๊ะๆ ไม่งั้นถูกปฏิเสธที่ stage `"authenticate"` **ก่อน** อ่าน
`process.env` แม้แต่ครั้งเดียว — เดิม adapter นี้ยอมรับชื่อ env var ใดก็ได้
ตามที่ connection ระบุมา (ทั่วไป, ใช้ได้กับหลาย connection) Owner สั่งกลับ
กฎนี้เพื่อตัดความเสี่ยงที่ connection จะถูกตั้งค่าผิดให้ไปอ่าน env var อื่น
โดยไม่มีใครรู้ตัว

**ไม่มีทาง fallback ไปที่อื่นได้แม้แต่ทางเดียว:**
- ไม่ fallback ไป git credential helper — โฟลเดอร์นี้ไม่เรียก `git` เลย
  (ยืนยันแล้วว่าไม่มี `child_process`/`exec`/`spawn` ในทั้งโฟลเดอร์)
- ไม่ fallback ไป macOS Keychain หรือ credential store ใดของเครื่อง — ไม่มี
  โค้ดใดในโฟลเดอร์นี้เรียก keychain ทุกกรณี
- ไม่ fallback ไป env var ชื่ออื่นแม้ `credential_ref.name` จะระบุมา —
  ถูกปฏิเสธก่อนอ่านค่าจริงเสมอ

หลักฐานที่ resolve สำเร็จจะปรากฏใน event เป็น `credential_source =
"env:GITHUB_PAT_INFRASTRUCTURE"` ตรงตัว — ตรวจได้จาก output จริง ไม่ใช่แค่
คำยืนยันในเอกสาร

**บังคับด้วย:** `EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME` ใน
`adapter-config.ts` + การตรวจใน `credential-resolution.ts` ก่อน
`readEnvVar()` ทุกครั้ง + assertion จริงใน `adapter.test.ts` (ทั้ง
offline: ปฏิเสธชื่ออื่น, และ live: `credential_source` ตรงตามที่คาด)

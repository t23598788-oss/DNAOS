# DNA OS ↔ GitHub Source Authority Connection

Canonical document ID: `connection.github.dna-os-source-authority.v1`

เอกสารนี้เป็น human/developer projection ของ [connection-document.json](./connection-document.json) ซึ่งเป็น semantic record ที่ authoritative เพียงชุดเดียว และถูก project เข้า [Connection Index](../connection-index/INDEX.md)

## สถานะสรุป

สถานะรวมคือ `CONNECTED` แบบ partial verification: GitHub capability, credential reference, และ read API มีอยู่จริง Contents write สำหรับ repository ที่ลงทะเบียนแล้วถูกปิด (`DENIED_BY_ARCHITECTURE`) และ DNA OS GitHub Publish Authority เป็น `VERIFIED` หลัง live remote SHA เท่ากับ DNA OS commit `30e313dbb9167376799677f9268189ff6e894809`

| Boundary | Status | ความหมาย |
|---|---|---|
| GitHub provider/repository declaration | `CONNECTED` | มี source-authority declaration, API target และ credential reference |
| Owner router → GitHub Capability Registry | `VERIFIED` | command ไปถึง `handleGithubCommand` จริง |
| Account-scope authority gate | `VERIFIED` | ปฏิเสธ wrong adapter และ cross-account ก่อน credential/network |
| Credential reference → macOS Keychain | `VERIFIED` | registry metadata ต่อเข้ากับ Keychain provider จริง โดยไม่เก็บ secret value |
| GitHub read/access/status API | `VERIFIED` | live suite อ่าน repository ที่ credential เข้าถึงได้ |
| Declared infrastructure repository access | `BLOCKED` | target repo คืน HTTP 404 ด้วย credential ที่ใช้ได้กับ `/user` |
| Admission → source-execution | `CONNECTED` | orchestration และ pre-execute gates มีจริง; live write ยังไม่ผ่านการพิสูจน์ |
| Branch/path validation | `VERIFIED` | branch ต้องระบุเอง; path traversal และ unsafe path ถูกปฏิเสธ |
| Contents write → one commit | `DENIED_BY_ARCHITECTURE` | ปิดสำหรับ registered SOURCE_AUTHORITY repo นี้ |
| DNA OS GitHub Publish Authority | `VERIFIED` | Keychain Device Flow credential authenticated as `t23598788-oss`; DNA OS commit SHA equals remote `main` after publish |
| Commit/result/evidence return | `CONNECTED` | มี persistence/idempotency path และ offline assertions |
| Local worktree → GitHub | `NOT_WIRED` | source execution ส่ง source content ไม่ได้ผูก local worktree กับ GitHub |
| Pull Request | `NOT_WIRED` | ไม่มี PR endpoint หรือ contract |
| Inbound push webhook verifier | `CONNECTED` | pure verifier และ tests มีจริง แต่ไม่มี HTTP listener live |

## ข้อมูลเดินทาง

### Read path

`Owner Command → routeOwnerCommand → Capability Registry → handleGithubCommand → account-scope gate → credential reference → GitHub GET API → normalized EventEnvelope/rejection`

รองรับเพียง `connector.github.check_access` และ `connector.github.read_status` ผลลัพธ์เป็น repository/branch/path metadata เท่านั้น ไม่คืน file content

### Source write path

`ADMITTED Engineering result → DNA OS Commit Authority → DNA OS GitHub Publish Authority → git push of that commit to the registered GitHub destination`

GitHub Contents API (`putFileContents`) และ `executeSource` สำหรับ repository ที่ลงทะเบียนนี้คืน `DNA_OS_PUBLISH_AUTHORITY_REQUIRED` ไม่มี worker GitHub token และไม่มี force push

### Branch, worktree และ PR

Owner/source execution ต้องส่ง `owner`, `repo`, `branch` และ source path เอง ไม่มี default branch และไม่มี worktree boundary ใน GitHub connector นี้ การมี provider หรือ write API ไม่ได้แปลว่ามี Pull Request หรือ deployment connection

## Authority และ failure gates

- `connection.account_id` ต้องตรงกับ `issued_by.acting_as_account_id`
- credential ต้องมาจาก registered Keychain reference หรือ explicit legacy env channel เท่านั้น
- source execution ต้องมี persisted `ADMITTED` result, matching artifact/task/target และ `authorized_action=WRITE_SOURCE`
- repository ต้องถูกตรวจด้วย `getRepository` ก่อนเขียน
- source path ต้องผ่าน repo-relative safety checks
- GitHub 401/403/404/429, transport errors และ malformed responses ถูกคืนเป็น failure ไม่ถูกแปลงเป็น success
- GitHub 404 ของ repository แยกไม่ได้ว่าไม่มี repo หรือ token มองไม่เห็น จึงบันทึกเป็น `BLOCKED`/unresolved access ไม่เดา
- webhook ตรวจ signature จาก raw body ก่อน parse JSON และใช้ constant-time comparison

## หลักฐานและข้อจำกัด

มี live read evidence กับ repository ที่ credential เข้าถึงได้ (`t23598788-oss/camo`) และมีหลักฐานว่า credential เดียวกันตอบ `/user` แต่ target infrastructure repository คืน HTTP 404 จึงยังไม่ claim target access หรือ live write

`control/source-execution/tests/source-execution.test.ts` มี live commit/evidence suite แต่ระบุชัดว่า skip เมื่อไม่มี live credential/target variables ดังนั้น commit/write boundary จึงเป็น `NOT_VERIFIED`

## เอกสารที่เกี่ยวข้อง

- Machine semantic record: `connections/github/connection-document.json`
- Human document: `connections/github/GITHUB_CONNECTION.md`
- Connection Index: `connections/connection-index/INDEX.md`

# DNA OS ↔ DigitalOcean Connection

Canonical document ID: `connection.digitalocean.dna-os-provider.v1`

เอกสารนี้เป็น human/developer projection ของ [connection-document.json](./connection-document.json) ซึ่งเป็น semantic record ที่ authoritative เพียงชุดเดียว และถูก project เข้า [Connection Index](../connection-index/INDEX.md)

## สถานะสรุป

สถานะรวมคือ `BLOCKED` ไม่ใช่ `VERIFIED` เพราะ command path ไปถึง DigitalOcean connector จริง แต่ production account-binding registry และ Vault credential broker ยังไม่มีอยู่จริง จึงไม่มี credential สำหรับ authenticated DigitalOcean call

| Boundary | Status | ความหมาย |
|---|---|---|
| Provider/resource catalog | `CONNECTED` | มี provider definitions, resource actions, endpoints และ scope records |
| Owner router → Capability Registry | `VERIFIED` | live-tested ว่า command ถูก classify และไปถึง capability `digitalocean` |
| Capability Registry → connector invoker | `VERIFIED` | invoker ถูก register และคืน `ConnectorBoundaryOutcome` จริง |
| Connector invoker → read adapter | `VERIFIED` | adapter ถูก compose ด้วย production providers และ fail-closed |
| Account binding registry | `NOT_WIRED` | มี type/interface แต่ไม่มี registry หรือ persistence; production provider คืน `undefined` |
| Binding status/scope gates | `VERIFIED` | expired/revoked/unverified และ missing scope ถูกปฏิเสธก่อน credential/network |
| Credential broker / Vault | `NOT_WIRED` | production provider คืน `VAULT_NOT_YET_BUILT` และไม่มี Vault client |
| Authenticated DigitalOcean API | `BLOCKED` | endpoint จริงตอบ แต่ไม่มี authenticated credential; evidence เป็น HTTP 404/unauthenticated HTTP 403 |
| Normalized result/evidence | `VERIFIED` | มี typed result/rejection และ safe evidence trail |
| DigitalOcean deployment/hosting resource | `NOT_WIRED` | provider catalog ไม่ใช่หลักฐานว่ามี Droplet/App Platform deployment จริง |

## ข้อมูลเดินทางอย่างไร

`Owner command → routeOwnerCommand → Capability Registry → Connector Execution Boundary → invokeDigitalOceanConnector → handleDigitalOceanReadCommand → binding/status/scope gates → credential provider → DigitalOcean GET API → normalized result/evidence`

ปัจจุบัน flow หยุดที่ binding lookup เพราะ `productionAccountBindingProvider` ไม่มี registry และคืน `undefined` ทำให้ router ส่งผล `BLOCKED` พร้อม `AUTH_REQUIRED` โดยไม่อ่าน credential และไม่ยิง authenticated network call

Connector นี้มีเฉพาะห้า read intents:

- `digitalocean.account.read`
- `digitalocean.regions.list`
- `digitalocean.sizes.list`
- `digitalocean.droplets.list`
- `digitalocean.billing.read`

`hostFetch` รับเฉพาะ URL, headers และ timeout ไม่มี `method` หรือ `body` จึงเป็น GET-only โดยโครงสร้าง ส่วน create/update/delete, Spaces, Kubernetes, App Platform deployment และ resource mutation ไม่ได้ wired ใน connection นี้

## Authority และ failure gates

- Provider action definitions เป็น source ของ endpoint, method และ required scope
- Binding status gate ปฏิเสธ `expired`, `revoked`, `unverified`
- Scope gate ปฏิเสธ binding ที่ไม่มี scope ที่ต้องใช้
- Credential resolution เกิดหลัง authorization gates เท่านั้น
- ไม่มี raw secret อยู่ใน connection document; บันทึกเฉพาะ reference shape เช่น `vault://...`
- API non-2xx และ transport error ถูกคืนเป็น typed failure ไม่ถูกกลบเป็น success
- Provider catalog ไม่ได้แปลว่ามี deployment หรือ resource จริงใน DigitalOcean

## หลักฐาน

หลักฐานสำคัญคือ `control/command-router/tests/digitalocean-connector-routing.test.ts` ซึ่งพิสูจน์ว่า router ไปถึง connector จริงและได้ `BLOCKED/AUTH_REQUIRED`, `connections/digitalocean/tests/adapter.test.ts` ซึ่งพิสูจน์ fail-closed gates และ typed normalization, และ `dna-os-circuit/definition/circuit.json` ซึ่งบันทึก live API attempt ที่ได้ HTTP 404 กับ evidence trail จริง

## เอกสารที่เกี่ยวข้อง

- Machine semantic record: `connections/digitalocean/connection-document.json`
- Human document: `connections/digitalocean/DIGITALOCEAN_CONNECTION.md`
- Connection Index: `connections/connection-index/INDEX.md`

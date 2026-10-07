# DNA OS ↔ Railway Connection

Canonical document ID: `connection.railway.dna-os-provider.v1`

The machine-readable semantic record is [connection-document.json](./connection-document.json). The [Connection Index](../connection-index/INDEX.md) is a projection of that record; it is not a second status registry.

## สถานะสรุป

สถานะรวมคือ `CONNECTED` เพราะมี Railway project identity, connector และ Railway runtime evidence จริง และ **มีเส้นทาง Owner command ที่ลงทะเบียนแล้วใน `control/command-router/capability-registry.ts`** (entry `railway` → `invokeRailwayConnector`; live-verified 2026-09-22) แต่ยังไม่มี Postgres application wiring และไม่มี deployment/write connector

| Boundary | Status | ความหมาย |
|---|---|---|
| Railway project/environment identity | `VERIFIED` | project `dna-os-infrastructure` และ environment ID ถูกบันทึกใน provider/project registry และตรงกับ connector |
| Connector registry → Railway invoker | `VERIFIED` | `getConnectorInvoker("railway")` คืน invoker จริง |
| `railway.environment_status` → Railway GraphQL | `VERIFIED` | live evidence 2026-08-23 ได้ environment/project จริง |
| Credential reference → ACTIVE registry → macOS Keychain | `VERIFIED` | resolve ด้วย reference; ไม่บันทึก secret |
| Railway result → result/evidence | `VERIFIED` | คืน `ConnectorBoundaryOutcome` พร้อม safe evidence/artifact |
| Railway-hosted DNA OS deployments | `VERIFIED` | recovery evidence บันทึก SUCCESS/RUNNING และ HTTP health/auth probes |
| Owner command-router capability entry → Railway | `VERIFIED` | entry `railway` (`endpoint.kind: "connector"` → `invokeRailwayConnector`) อยู่ใน command-router capability registry แล้ว และ live 2026-09-22 ยืนยัน Owner command → Railway API จริง (mutation intents ที่ลงทะเบียนต้องมี Owner session ที่ `validateOwnerSession` ยืนยัน — entry นี้ไม่ได้ให้อำนาจ deploy เอง) |
| Railway CLI capability callers | `NOT_VERIFIED` | canonical registry มี live records แต่ไม่พบ caller implementation ใน repository นี้ |
| Railway Postgres → software_registry application | `NOT_WIRED` | service/schema มีหลักฐาน แต่ application wiring ถูกระบุว่ายังไม่ทำ |
| Railway deployment/write/mutation | `NOT_WIRED` | connector ที่มีอยู่เป็น read-only เท่านั้น |

## ข้อมูลเดินทาง

เส้นทางที่พิสูจน์แล้วคือ:

`CommandEnvelope → routeOwnerCommand (capability registry entry "railway") → executeConnectorCommand → getConnectorInvoker("railway") → invokeRailwayConnector → credential registry → macOS Keychain → POST https://backboard.railway.com/graphql/v2 → ConnectorBoundaryOutcome → result/evidence`

เส้นทางนี้เป็น Owner command routing ที่ verified แล้ว: `control/command-router/capability-registry.ts` มี entry `railway` (`endpoint.kind: "connector"`) และ live evidence 2026-09-22 ยืนยันว่า Owner command ไปถึง Railway API จริง — ไม่ใช่แค่ `getConnectorInvoker("railway")` แยกเดี่ยวอีกต่อไป

## Railway resources และ runtime

- Provider project: `dna-os-infrastructure`
- Environment reference: `4d28eafa-9735-4405-a585-55ea354bafab`
- GraphQL endpoint: `https://backboard.railway.com/graphql/v2`
- Registered provider resource: `resource-7691c9a8-4bed-4c12-adb7-c66b93f86f16`
- Credential reference: `credential://railway/dna-os-infrastructure/production/project-token`
- Railway service `owner-command-http`: deployment `3247c5ac-cf51-424c-9131-4e5f834c8ddd`, SUCCESS/RUNNING; no public domain by design; Railway healthcheck and startup-log evidence
- Railway service `dna-os-circuit/runtime`: deployment `40ffd5ab-3033-4c14-9fd6-23b153cb9fd5`, public `/circuit.json` returned 200 and unauthenticated `/evaluate` returned 401
- Railway service `observability/joint-monitor`: deployment `0a0ecaca-e4fe-4b90-976b-d6822a567763`, public `/joints` returned 200
- Railway Postgres service: `f871f760-8d2d-4200-ba6b-c24be36aeda9`; schema evidence exists, application wiring is explicitly not done

The deployment observations are historical evidence from `reports/RECOVERY_INDEX_2026-08-24.md`; they prove the recorded deployment/runtime state at that verification point, not an unqualified current-state probe.

## Authority and failure gates

- Railway identity records do not grant mutation authority.
- The connector routes the intents declared in `connections/railway/router-invoker.ts` (reads + mutations); every mutation requires a live Owner session validated by `control/owner-authentication`'s `validateOwnerSession`, and neither this document nor the capability entry grants deployment/mutation authority.
- The credential reference must be registered and `ACTIVE`; Keychain resolution must succeed.
- API non-2xx, GraphQL errors, missing environment data, and unsupported intents become typed failures.
- The token is kept local to the invoker and never appears in this document, result, or evidence.
- A Railway service or deployment record does not prove that DNA OS application code uses the service.
- No write/deploy/mutation authority is documented or wired.

## Evidence

- `software/registry-database/data/canonical/capabilities.jsonl#capability-41d17cbe-fcea-4ca7-b911-a4f49bb5d63a` — Railway connector contract and 2026-08-23 live verification.
- `software/registry-database/data/canonical/registration_events.jsonl#event-390781a4-60e9-4e39-c754e343f4ab` — registration plus live `getConnectorInvoker("railway")` result.
- `software/provider-project-registry/data/provider-projects.jsonl` — canonical project/environment identity.
- `connections/connection-registry/data/connection-declarations.jsonl` — declared endpoint, credential reference, scope, and current `UNRESOLVED` target-resolution state.
- `reports/RECOVERY_INDEX_2026-08-24.md` — Railway deployment, domain, health, auth-gate, and Postgres evidence.
- `software/registry-database/data/canonical/capabilities.jsonl#railway.*` — recorded Railway CLI read capability observations dated 2026-09-05; caller boundary remains `NOT_VERIFIED`.
- `control/command-router/capability-registry.ts#railway` — the Owner-command capability entry (ported to main from `8b0d4ee`; `supported_commands` re-synced to the invoker's post-PR-#34 intent set `READ_INTENTS ∪ MUTATION_INTENTS`).
- Live Owner-command verification 2026-09-22 (macOS Keychain credential + real Railway GraphQL API): `routeOwnerCommand` → capability entry `railway` → `executeConnectorCommand` → `getConnectorInvoker("railway")` → `invokeRailwayConnector`; routed from the Owner's own text (`routing_source=STRUCTURED_OWNER_CONTEXT selected_capability_id=railway`) and returned `ConnectorBoundaryOutcome` `ok=true`, summary `railway environment "production" reachable, project ffe589bf-58fb-4e3e-8969-4a75915fda1a`, artifacts `environment_id 4d28eafa-9735-4405-a585-55ea354bafab`, `project_id ffe589bf-58fb-4e3e-8969-4a75915fda1a`, `environment_name production`.

## เอกสารที่เกี่ยวข้อง

- Machine semantic record: `connections/railway/connection-document.json`
- Human document: `connections/railway/RAILWAY_CONNECTION.md`
- Connection Index: `connections/connection-index/INDEX.md`
- Index machine record: `connections/connection-index/index.json`

# control/runtime-endpoint-registry/

**หน้าที่:** the one canonical owner of **listen URLs** for Core runtime
services (`RuntimeEndpointRegistration` + `resolveRuntimeEndpoint`).

This is not a second connection registry, not a second repository
registry, and not a second `control/runtime-control` SERVICES catalog.

- **Identity of a local process** stays in `control/runtime-control`
  `ServiceDefinition` (ports, health_path, spawn). This folder **projects**
  those four Core listen targets into endpoint rows.
- **Connection / GraphQL provider identity** stays in
  `connections/connection-registry` (Railway backboard is not a hosted-app
  URL).
- **REGISTERED_REMOTE** listen URLs are supplied by optional provider
  adapters as JSONL (today: `connections/railway/data/runtime-endpoints.jsonl`).
  Core resolves them; it does not invent `*.railway.app` hostnames.

**Input:** `endpoint_id` or `capability_id`; optional purpose `execute` | `observe`.  
**Output:** one ACTIVE endpoint, or fail-closed.  
**Dependency ที่อนุญาต:** `control/runtime-control` (SERVICES only),
`contracts/architecture/runtime-node-and-optional-provider` (node kind),
Node fs/path. Optional adapter JSONL is data, not GraphQL.  
**สิ่งที่ห้ามแตะ:** ห้ามใส่ Railway/Vercel ids ใน canonical contract;
ห้าม scan เครือข่ายตอน resolve; ห้ามเดา provider จาก hostname;
ห้าม mutate ทะเบียนตอน resolve.

## Why a new folder (duplicate-gate)

Audited owners cannot carry `endpoint_id` + `scope` + `source` +
`ACTIVE|DRAINING|DISABLED` without overload:

| Owner | Why not |
|---|---|
| connection-registry | Railway row is GraphQL `backboard.railway.com` |
| runtime-control SERVICES | local process catalog, not PUBLIC listen URLs |
| machine-observation | `OBSERVE_ONLY` |
| capability-route | join, not store; ambiguous on local+remote |
| production-checkpoint | historical Railway binding |
| provider-project-registry | project identity, not listen URLs |

## Resolution

`resolveRuntimeEndpoint` is the only canonical path. Execution uses
`ACTIVE` only. `DRAINING` is observable, not executable. `DISABLED` is
neither. Two ACTIVE rows for one `capability_id` without an
`endpoint_id` is fail-closed (`AMBIGUOUS_ENDPOINT`).

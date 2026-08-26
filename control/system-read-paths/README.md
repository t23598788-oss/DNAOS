# control/system-read-paths/ — what the system can be asked, declared

**หน้าที่:** the index of DNA OS's read paths. Every entry points at a function
that already existed on a public contract; nothing here adds capability.

**Why it exists:** `control/agent-gateway/contract.ts` had exported
`loadEvidenceForTask` all along and it was missed until someone read the source
by hand. Discovering what the system can answer by grepping is not a method — it
fails silently. `verifyReadPaths()` resolves every declared symbol in the
running process, so a declaration that no longer holds fails loudly.

**REQUEST and RESPONSE are separate declarations.** There is no `↔` anywhere in
this folder:

```
SYSTEM RESOLUTION --REQUEST(lookup_key, schema)--> READ PATH
SYSTEM RESOLUTION <--RESPONSE(schema, provenance, failure_state)-- READ PATH
```

`readPathCircuitGraph()` renders exactly that: two directed edges per path, each
carrying its own schema and its own evidence.

**Input:** a lookup key per domain — never Owner language. A phrase is the
semantic layer's business; a key is this layer's.
**Output:** declarations, runtime verification, the circuit graph, the external
Blueprint read boundary, and the conformance classifier.

**Dependency ที่อนุญาต:** the PUBLIC contracts of the capabilities it indexes,
plus node built-ins. Reaching into another capability's internals is what makes
`NOT_ON_PUBLIC_CONTRACT` a reportable status instead of a temptation.

**สิ่งที่ห้ามแตะ:**
- ห้ามประกาศ read path ที่ไม่มี provider จริง.
- ห้ามรวม request/response เป็น edge เดียว.
- ห้าม export ฟังก์ชันเขียน — read paths only.
- ห้ามคัดลอกเอกสารจาก DNA-OS-BLUEPRINT เข้ามา — `./blueprint-index.ts` holds a
  path and a parser, and reports NO_RUNTIME_CONTRACT when the external
  repository is absent rather than falling back to a stale embedded copy.
- ห้ามให้ `./conformance.ts` แก้ทั้ง source และเอกสาร — it classifies; the Owner decides.

## Declared domains

| domain | lookup key | provider |
|---|---|---|
| RESOURCE | `resource_id` | `software/registry-database/contract.ts#findResourceById` |
| CAPABILITY | `capability_id` | `software/registry-database#findCapability`, `control/command-router#getCapability`, `execution/run#listCommandDescriptors` |
| TASK | `task_id` | `control/agent-gateway#getTask` / `#explain` / `#loadHandoffsForTask` |
| EVIDENCE | `task_id`, `capability_id` | `control/agent-gateway#loadEvidenceForTask`, `software/registry-database#findCapability` |
| EVENT | collector base url | `observability/joint-monitor` `GET /joints` |
| STATE | `task_id` | `control/agent-gateway#getTask` |
| DOCUMENT | source reference | `./blueprint-index.ts#readBlueprintReferences` (external repository) |

## วิธีรัน

```
npx tsx control/system-read-paths/tests/read-path-registry.test.ts
curl http://<circuit>/read-paths.json     # the two-directed-edge view
```

## Known limits

- `RP-EVENT-JOINTS` is `NOT_ON_PUBLIC_CONTRACT`: joint-monitor exports the
  `JointStore` class, not a process-wide read function, so this path is
  exercised over HTTP and cannot be verified by symbol resolution.
- `loadTaskHistory` / `loadAllTasks` exist in `control/agent-gateway/memory-store.ts`
  but are NOT on its public contract, so they are not declared here. Reaching in
  would break the same boundary this folder is trying to make legible.

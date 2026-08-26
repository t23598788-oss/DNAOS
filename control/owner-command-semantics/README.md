# control/owner-command-semantics/ — Owner language in, proven references out

**หน้าที่:** the layer between `../owner-command/`'s `submitOwnerCommand` and
`../entry-context/`'s `resolveEntryContext`. It turns one sentence of Owner
Thai/English into a `StructuredOwnerContext` whose ids were all proven against
registries that already existed.

```
OWNER INPUT → OWNER COMMAND → [AI SEMANTIC] → [DETERMINISTIC RESOLVER] → STRUCTURED OWNER CONTEXT → ENTRY CONTEXT → ROUTER
```

**The division of labour, which is the whole point:**

| | may say | may never say |
|---|---|---|
| `semantic-runner.py` (Qwen, local) | "the Owner called it 'ตัวคำนวณอันเมื่อกี้'" | which capability/resource/task that is |
| `resolver.ts` | "that phrase = `github`, proven by `capability-registry.ts#github`" | anything without a registry hit |

The model gets no id fields in its schema at all, and `ai-contract.ts` refuses
any value shaped like a real id. `resolver.ts` additionally refuses to resolve a
phrase that is not a quote from the Owner's own text — a paraphrase would mean
the proven id traces back to the model's words instead of the Owner's.

**Three outcomes, no fourth:** exactly one real match + evidence →
`RESOLVER_MATCHED`; more than one → `RESOLVER_AMBIGUOUS` with every candidate
listed; none → `RESOLVER_UNRESOLVED`. There is no "probably".

**Input:** the Owner's raw text + identity, from `../owner-command/`.
**Output:** `StructuredOwnerContext` — the model's reading (`ai`) and the proven
references kept strictly apart, plus `source_trace` naming where each field came
from (`OWNER_TEXT`/`AI_INTERPRETATION`/`REGISTRY`/`RESOURCE_GRAPH`/`HISTORY`/`RUNTIME`/`EVIDENCE`).

**Dependency ที่อนุญาต:** `../command-router/contract.ts` (capability registry,
read-only), `../../execution/run/contract.ts` (command descriptors),
`../../software/registry-database/contract.ts` (resource graph, read-only),
`../entry-context/` is called by `../owner-command/`, not from here.

**สิ่งที่ห้ามแตะ:**
- ห้ามให้โมเดลตัดสิน permission / lifecycle / execution — it labels words, nothing else.
- ห้ามให้โมเดลสร้าง capability, resource, หรือ id ใดๆ.
- ห้ามเขียนทะเบียนจากโฟลเดอร์นี้ — every registry call is read-only.
- ห้าม RESOLVER_MATCHED โดยไม่มี `evidence_refs`.
- ห้ามให้ `policy_command_id` เป็น `"unknown"` — either a registered descriptor or `null`.
- ห้ามเดา continuation จากความคล้ายของข้อความ — only from this layer's own history record.

## Files

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `types.ts` | contract | the AI schema (text only), `ResolvedReference`, `StructuredOwnerContext` |
| `ai-contract.ts` | guard | validates the model's output; refuses unknown fields and id-shaped values |
| `semantic-runner.py` | source | the only file that loads the model |
| `run-semantic.sh` + `sandbox-profile.sb` | source + policy | `env -i` + kernel `(deny network*)` and no repo access, on every run |
| `resolver.ts` | source | the deterministic half — registry/graph/history lookups and the three outcomes |
| `contract.ts` | contract | the only file a caller outside this folder may import |
| `data/semantic-history.jsonl` | data | this layer's own durable history, what continuation resolves against |
| `tests/semantic-resolution.test.ts` | test | the six Owner-stated cases, against the real model and real registries |

## วิธีรัน

```
npx tsx control/owner-command-semantics/tests/semantic-resolution.test.ts
```

Node >=18 (`../../.nvmrc` pins 24) and the local
`mlx-community/Qwen3-4B-Instruct-2507-4bit` weights. The model runs offline.

## Known limits (stated, not hidden)

- **Fail-open.** If the model process cannot run, `../owner-command/` proceeds on
  exactly the path it used before this layer existed. A translation aid must
  never be the reason an Owner command cannot be issued — but it does mean the
  structured payload is absent in that case, not wrong.
- **Latency.** Every Owner command now waits on a local model run (tens of
  seconds on this machine). `SemanticOptions.enabled = false` exists for suites
  that must not spawn it.
- **The resource graph has no free-text search.** `software/registry-database`
  answers exact `resource_id`/`canonical_name` only, so a resource named in
  prose is `RESOLVER_UNRESOLVED` — the honest answer, not a shortfall papered
  over with fuzzy matching.

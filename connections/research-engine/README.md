# connections/research-engine/ — BUILT (read-only: health check / latest result)

**หน้าที่:** adapter สำหรับเชื่อมต่อ DNA-LAB-PERMISSION-REASONER's Research &
Evaluation Engine — a real local HTTP JSON service, reachable at
`http://localhost:8787` in this environment. เก็บ source code ของตัวเชื่อม
(HTTP client + response mapping) เท่านั้น ไม่เก็บ/ไม่ vendor โค้ดของ research
engine เอง — repo นั้นไม่ได้อยู่ใน checkout นี้เลย

**ขอบเขตรอบนี้:** health check + read latest result **เท่านั้น** — GET-only,
ไม่มี write/train/trigger-run ใดๆ ไปยัง research engine

**Architecture:**

```
Owner Command → Command Router → research-engine adapter → HTTP read-only API → Research Engine → CapabilityResult → Owner Command
```

**Input:** none required from a caller — `fetchResearchEngineLatestResult({ baseUrl?, timeoutMilliseconds? })`
takes optional overrides (used by `./tests/adapter.test.ts` to point at a
fake server); with no arguments it targets the real default,
`http://localhost:8787`.

**Output:** a `ResearchEngineStepOutcome` — field-for-field the same shape
`../../control/command-router/router.ts`'s private `StepOutcome` already
uses for every other capability (`status`, `evidenceEntries`, `artifacts`,
`warnings`, `summary`). The router adds `task_id`/`capability_id` and the
result becomes a real `CapabilityResult`
(`../../contracts/command/capability-result.ts`) — this adapter never
constructs a `CapabilityResult` itself, since `task_id` is scoped to the
Owner's whole command, not to one capability call.

**Dependency ที่อนุญาต:** `../../contracts/command/capability-result.ts`
(type-only, shared result contract) — nothing else outside this folder.

**สิ่งที่ห้ามแตะ:** ห้าม import/vendor โค้ดจาก repo
DNA-LAB-PERMISSION-REASONER เด็ดขาด (ไม่มีอยู่ใน checkout นี้), ห้ามมี method
อื่นนอกจาก GET ในไฟล์ใดของโฟลเดอร์นี้ (`../research-read-api.ts`/`../host-runtime.ts` บังคับด้วยไม่มี body parameter),
ห้าม synthesize ผลลัพธ์งานวิจัยปลอมเมื่อ service offline — offline ต้องเป็น
`status: BLOCKED` + warning `RESEARCH_ENGINE_OFFLINE` เท่านั้น, ไม่มี mock
fallback

---

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `adapter-contract.ts` | contract | intent / field shape / step-outcome shape ของ adapter นี้เอง |
| `adapter-config.ts` | config | ค่าไม่ลับ: base URL default, endpoint path ทั้งสอง, timeout |
| `host-runtime.ts` | source | ประกาศ host API เท่าที่ใช้ (`fetch` แบบ GET-only, `AbortSignal.timeout`) |
| `research-read-api.ts` | source | เรียก `/api/research/health` และ `/api/research/latest` จริง — GET อย่างเดียว |
| `payload-validation.ts` | source | แปลง response ดิบ (`unknown`) ของ `/api/research/latest` ให้เป็น `ResearchEngineLatestFields` ที่ตรวจแล้ว |
| `research-engine-adapter.ts` | source | **ทางเข้าเดียว** — `fetchResearchEngineLatestResult()`, `checkResearchEngineLiveHealth()` |
| `tests/adapter.test.ts` | test | test จริง รันได้เป็นโฟลเดอร์เดียว (fake-fetch scenarios + optional live smoke check) |
| `ARCHITECTURE_DECISIONS.md` | ADR | ADR-RE-001: field-name mapping, latency-field assumption, static-vs-live CONNECTED |
| `README.md` | doc | ไฟล์นี้ |

## วิธีรัน test

ไม่มี test framework และไม่มี `package.json` ใน repo นี้ — `tests/adapter.test.ts`
เป็นโปรแกรมที่มี assertion ของตัวเอง รันตรงได้เลย ไม่ต้องมี server จริงรันอยู่:

```
npx tsx connections/research-engine/tests/adapter.test.ts
```

ทุก scenario บังคับ (connected / offline / malformed / timeout) ใช้ fake
global `fetch` — ไม่พึ่ง network จริง จึงรัน CI ได้แน่นอน หลังจบ suite หลัก
(ต้องผ่านทั้งหมดก่อน) มี "optional live smoke check" ต่อท้ายที่ยิงไปยัง
`http://localhost:8787` จริง ถ้ามันรันอยู่ — แต่ไม่มีผลต่อ exit code ไม่ว่า
server จะ up หรือ down (แค่ report สิ่งที่เห็นจริง)

## หลักฐานจริง (2026-08-16)

ระหว่างสร้าง adapter นี้ ได้ตรวจสอบด้วย `curl` จริงกับ
`http://localhost:8787` (server ตัวจริงรันอยู่ในเครื่องนี้ตอนนั้น):

- `GET /api/research/health` → `{"status": "ok"}`
- `GET /api/research/latest` → payload จริงรูปแบบ `{ status, experiment_id,
  baseline: {...}, candidate: {...}, candidate_warm_lifecycle?: {...} }`
  observed สำหรับ `experiment_id="exp-mock-vs-mlx-a1c9e3b5"`:
  `candidate.identity.provider="MLX"`,
  `candidate.identity.model_id="mlx-community/Qwen3-4B-Instruct-2507-4bit"`,
  `candidate.formulas.SAFETY_SCORE.value=-200.0`,
  `candidate.formulas.EFFICIENCY_SCORE.value=0.0718...`,
  `candidate.formulas.VALUE_GAIN.value="NOT_MEASURED"` (literal string, not
  a number — ไม่ coerce เป็น 0/null), `candidate.decision.decision="INSUFFICIENT_DATA"`,
  `candidate.metrics.false_allow_rate=0.0`, `candidate.metrics.unknown_rate=1.0`,
  `candidate.metrics.malformed_rate=1.0`, และ latency keys จริงคือ
  `average_latency_ms`/`p50_latency_ms`/`p95_latency_ms`/`p99_latency_ms`
  (ใต้ `metrics`) กับ `cold_start_latency_ms`/`warm_latency_ms`/`model_load_ms_first_case`/`prompt_eval_ms`/`generation_ms`
  (ใต้ `lifecycle`) — adapter นี้เก็บทุกตัวที่มีคำว่า "latency" ในชื่อ key
  โดยไม่ hardcode รายชื่อ exact (ดู `./ARCHITECTURE_DECISIONS.md`)

## field-name mapping (ตรวจแล้ว ไม่ใช่การเดา)

| field ใน `ResearchEngineLatestFields` | อ่านจาก path จริงใน response |
|---|---|
| `experiment_id` | top-level `experiment_id` |
| `run_id` | `candidate.run_id` (fallback `candidate.identity.run_id`) |
| `provider` | `candidate.identity.provider` |
| `model_id` | `candidate.identity.model_id` |
| `safety_score` | `candidate.formulas.SAFETY_SCORE.value` |
| `efficiency_score` | `candidate.formulas.EFFICIENCY_SCORE.value` |
| `value_gain` | `candidate.formulas.VALUE_GAIN.value` |
| `resource_penalty` | `candidate.formulas.RESOURCE_PENALTY.value` |
| `model_utility_score` | `candidate.formulas.MODEL_UTILITY_SCORE.value` |
| `research_decision` | `candidate.decision.decision` |
| `false_allow` | `candidate.metrics.false_allow_rate` (renamed — the server's own field is `false_allow_rate`) |
| `unknown_rate` | `candidate.metrics.unknown_rate` |
| `malformed_rate` | `candidate.metrics.malformed_rate` |
| `latency` | every key containing "latency" (case-insensitive) from `candidate.metrics` + `candidate.lifecycle` |

`baseline` and `candidate_warm_lifecycle` are not read into
`ResearchEngineLatestFields` — this round reports on `candidate` (the model
actually under evaluation), matching the Owner's requested field list.
Nothing is silently dropped: `baseline`/`candidate_warm_lifecycle` were
never in the requested field list to begin with, and extending
`ResearchEngineLatestFields` later to include them is a small, additive
change, not a rewrite.

## ยังไม่ได้สร้าง (NOT_YET_BUILT — ระบุไว้ ไม่ใช่ละไว้เงียบๆ)

- **credential/auth** — the real service exposed no auth in this round's
  `curl` checks; if that changes, the credential channel follows
  `../github/credential-resolution.ts`'s shape, not a new invention.
- **any write/trigger endpoint** (e.g. "start a new experiment run") — this
  capability is GET-only by construction (`./host-runtime.ts`'s `hostFetch`
  takes no method/body parameter).
- **`baseline` / `candidate_warm_lifecycle` typed fields** — present in the
  raw response, not yet mapped into `ResearchEngineLatestFields` (see
  "field-name mapping" above).
- **polling / streaming updates** — one `fetchResearchEngineLatestResult()`
  call is one point-in-time read; no subscription/webhook exists.

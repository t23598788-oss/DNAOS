# RESEARCH-ENGINE CONNECTION — BUILD REPORT

Scope: connect `research-engine` as a real external read-only HTTP
capability, per Owner instruction 2026-08-16. Built
`connections/research-engine/` (new capability folder, mirrors
`connections/github/`'s pattern) and wired it into
`control/command-router/`. No new repository, no UI, no write/mock path.
Nothing committed, pushed, or deployed — working tree only.

---

## RESEARCH_ENGINE_CONNECTION_STATUS

Built and tested. `connections/research-engine/` exports one public entry
point, `fetchResearchEngineLatestResult()` (plus a lighter
`checkResearchEngineLiveHealth()`), from `research-engine-adapter.ts`. It:

1. calls `GET /api/research/health` first — a command never reaches
   `/api/research/latest` if the health check does not report a real HTTP
   2xx,
2. calls `GET /api/research/latest` and parses the real observed response
   shape (`{ status, experiment_id, baseline, candidate,
   candidate_warm_lifecycle? }`) via `payload-validation.ts`, defensively —
   no `throw` anywhere in the parse path,
3. maps every Owner-required field
   (`experiment_id, run_id, provider, model_id, safety_score,
   efficiency_score, value_gain, resource_penalty, model_utility_score,
   research_decision, false_allow, unknown_rate, malformed_rate`) plus a
   `latency` bag (every key containing "latency", case-insensitive, from
   `candidate.metrics` + `candidate.lifecycle` — no exact-name assumption)
   into evidence entries and one `research_run_id` artifact,
4. always resolves — never throws — to a `ResearchEngineStepOutcome`
   (field-for-field the same shape `control/command-router/router.ts`'s
   private `StepOutcome` already uses for every other capability), which
   the router folds into a real `CapabilityResult` by adding
   `task_id`/`capability_id`.

GET-only by construction: `host-runtime.ts`'s `hostFetch` takes no
method/body parameter, so no write call is even expressible in this folder.
No source from DNA-LAB-PERMISSION-REASONER was imported or vendored — it is
not present in this checkout; this adapter knows only the HTTP contract
(two URL paths + JSON shape).

## HEALTH_CHECK

`http://localhost:8787` was **live** during this work. Verified with real
`curl` calls before writing any code:

- `GET /api/research/health` → `{"status": "ok"}`
- `GET /api/research/latest` → a real, full payload for
  `experiment_id="exp-mock-vs-mlx-a1c9e3b5"`, candidate provider `MLX`,
  model `mlx-community/Qwen3-4B-Instruct-2507-4bit`, `SAFETY_SCORE=-200.0`,
  `EFFICIENCY_SCORE≈0.0718`, `VALUE_GAIN`/`RESOURCE_PENALTY`/`MODEL_UTILITY_SCORE`
  all the literal string `"NOT_MEASURED"` (passed through as-is, not
  coerced), `decision="INSUFFICIENT_DATA"`, `false_allow_rate=0.0`,
  `unknown_rate=1.0`, `malformed_rate=1.0`, and real latency keys
  `average_latency_ms`/`p50_latency_ms`/`p95_latency_ms`/`p99_latency_ms`
  (under `metrics`) and `cold_start_latency_ms`/`warm_latency_ms`/
  `model_load_ms_first_case`/`prompt_eval_ms`/`generation_ms` (under
  `lifecycle`). Full field-name mapping table is in
  `connections/research-engine/README.md`.

The optional live smoke check at the end of
`connections/research-engine/tests/adapter.test.ts` (never affects the
suite's pass/fail — see below) confirmed the same live server end-to-end
through the real adapter code, producing `status=COMPLETED` and the exact
summary observed above.

`control/command-router/capability-registry.ts`'s `research-engine` entry
is now `health_status: "CONNECTED"` — meaning "a real adapter exists and is
wired," the same static-at-registration convention `github`/`execution`
already use. That static field never claims the live server is up at any
given instant; `control/command-router/router.ts`'s `runResearchEngineStep`
calls the adapter's own live health check on every routed request and
reports `BLOCKED` + warning `RESEARCH_ENGINE_OFFLINE` whenever the real
service is unreachable, regardless of the static field. Full reasoning:
`connections/research-engine/ARCHITECTURE_DECISIONS.md` (ADR-RE-001).

## ROUTING_RESULT

`control/command-router/router.ts` gained `runResearchEngineStep()` and a
dispatch branch in `runStep()` for `capability_id === "research-engine"`.
Because `ResearchEngineStepOutcome` already matches `StepOutcome`'s field
names, the wiring is a one-line passthrough — no new mapping code, no new
type needed in `control/command-router/types.ts`. `control/command-router/capability-registry.ts`'s
`research-engine` entry now points `endpoint` at
`{ kind: "adapter", module: "connections/research-engine/research-engine-adapter.ts",
entry: "fetchResearchEngineLatestResult" }` instead of
`{ kind: "not_yet_built" }`.

## FILES_CHANGED

New — `connections/research-engine/`:
- `adapter-contract.ts` — intent constant, `ResearchEngineLatestFields`,
  `ResearchEngineStepOutcome`, warning constants.
- `adapter-config.ts` — base URL default (`http://localhost:8787`), the two
  endpoint paths, request timeout (5s).
- `host-runtime.ts` — GET-only `hostFetch` (no method/body parameter).
- `research-read-api.ts` — real calls to `/api/research/health` and
  `/api/research/latest`.
- `payload-validation.ts` — defensive parse of the real response shape into
  `ResearchEngineLatestFields`, never throws.
- `research-engine-adapter.ts` — the one public entry point,
  `fetchResearchEngineLatestResult` / `checkResearchEngineLiveHealth`.
- `README.md`, `ARCHITECTURE_DECISIONS.md`.
- `tests/adapter.test.ts` — 7 fake-fetch scenarios + 1 optional live smoke
  check.

Modified:
- `control/command-router/capability-registry.ts` — `research-engine`
  entry: `contract`, `endpoint`, `repo_id`, `health_status` updated from
  `not_yet_built`/`NOT_CONNECTED` to the real adapter, with the
  static-vs-live distinction documented inline.
- `control/command-router/router.ts` — new import, new
  `runResearchEngineStep`, new dispatch branch, header dependency-list
  update.

Untouched (per scope): `control/owner-command/`, `permissions/`,
`execution/`, `connections/github/`, `file-intelligence` (still
`NOT_CONNECTED`, not touched).

## TEST_RESULTS

All commands run for real in this environment (not predicted):

```
npx tsx connections/research-engine/tests/adapter.test.ts
→ 7 passed, 0 failed
   PASS connected: health ok + well-formed latest -> COMPLETED, all required fields preserved
   PASS offline: health check transport error -> BLOCKED + RESEARCH_ENGINE_OFFLINE (latest never called)
   PASS offline: health ok but latest transport error -> BLOCKED + RESEARCH_ENGINE_OFFLINE
   PASS offline: health endpoint returns non-2xx -> BLOCKED + RESEARCH_ENGINE_OFFLINE
   PASS malformed: latest body not valid JSON -> FAILED + RESEARCH_ENGINE_MALFORMED_RESPONSE, no throw
   PASS malformed: valid JSON missing required fields -> FAILED, no throw
   PASS timeout: 150ms budget, real AbortSignal fires, resolves BLOCKED well under 3000ms (no hang)
→ optional live smoke check against real http://localhost:8787: status=COMPLETED
  (proves the real adapter code path end-to-end against the live server, in
  addition to the fake-fetch suite above — this check never affects the
  suite's own pass/fail)

npx tsx control/command-router/tests/router.test.ts
→ 9 passed, 0 failed (pre-existing suite, re-run to confirm no regression)

npx tsc --noEmit -p tsconfig.json (whole repo)
→ exit 0, zero type errors
```

No mock/synthesized research data exists anywhere in the connected path —
every `COMPLETED` result in the test suite and the live smoke check came
from a real (fake-server or real-server) HTTP 200 JSON body, parsed for
real.

# contracts/worker/

**Status: TYPES_DEFINED, FIELD-MAPPING-CORRECTED (2026-08-18). No AI Worker Gateway implementation exists. No Anthropic API key exists anywhere in this repo or environment.**

The three (soon four — one gap still open) shared wire-shapes for Owner's locked AI Worker Gateway loop:

```
4173 FILE INTELLIGENCE           finds a problem (real: Warning{type,evidence})
        │ FindingEvent (finding-event.ts) — TYPES_DEFINED, RUNTIME NOT_BUILT
        ▼
8790 CIRCUIT                     resolves CAPABILITY + OWNER + ROUTE + PERMISSION
        │ WorkRequest ─────────────────────────────┐  (work-request.ts)
        ▼                                          │
AI WORKER GATEWAY (NOT_YET_BUILT)                   │
  Claude Code SDK / Codex / Local AI                │
        │ edits source at target_owner_folder        │
        │ WorkerExecutionEvent (worker-event.ts)     │
        │ RUNTIME_BACKING = NOT_BUILT                 │
        ▼                                          │
TEST / FILE / GIT COLLECTORS (NOT_YET_BUILT)         │
        │                                          │
        ▼                                          │
5177 DNA LAB                     measures real executions.* fields
        │ EvaluationResult (evaluation-result.ts)
        ▼
8790 CIRCUIT                     updates BUILT / CONNECTED / VERIFIED / FAILED
        │                        (NOT automatic — see state-machine-separation.ts)
        └── if still FAILED ──→ new WorkRequest round
```

## 2026-08-18 correction pass

A field-by-field mapping check against the three real systems (Circuit's `CapabilityMetadata`, the Research & Evaluation Engine's real `executions` + `local_telemetry_samples` tables, File Intelligence's real `Warning` type) found the original shapes did **not** match reality in several places. Every field below was corrected against a real column/field, or explicitly marked as having no real counterpart — never silently left wrong.

## Files

| File | Contract | Status |
|---|---|---|
| `work-request.ts` | `WorkRequest`, `WorkRequestExecutionState` | provider_id/model_id/agent_id split to match real `executions` columns; `target_owner_folder` matches `CapabilityMetadata.OWNER_FOLDER`; 7 fields marked `NEW_CONTROL_FIELD` (no real runtime counterpart) |
| `state-machine-separation.ts` | `IntendedStatusTransitionGuidance` | documents why the 3 state machines (WorkRequest lifecycle / Lab execution status / CapabilityStatus) are never merged, and the Owner's own non-automatic-VERIFIED example, as a type — no executable logic |
| `worker-event.ts` | `WorkerExecutionEvent`, `WorkerEventType`, `WORKER_EVENT_RUNTIME_BACKING` | unchanged shape, now carries an explicit `RUNTIME_BACKING = "NOT_BUILT"` constant — mapping NOT verified, no real collector exists to check it against |
| `evaluation-result.ts` | `EvaluationResult` | renamed to match real `executions` columns (`execution_id`, `elapsed_ms`, `retry_count`), re-typed `local_cpu_time_ms`/`ram_peak_mb` to real semantics/units, added `cost_source`/`provider_cost_usd`/`provider_session_id`/`provider_turn_count`, `result` and `evidence_source` marked as new fields without a real DB column yet |
| `finding-event.ts` | `FindingEvent`, `FindingClassification`, `FindingStatus`, `FindingToWorkRequestMapping` | grounded in File Intelligence's real `Warning{type,evidence}`; `capability_id`/`severity` honestly `null` (no real source); `scan_id` flagged unprovable (no real scan-id field exists in File Intelligence) |
| `finding-event-gap.ts` | `FINDING_EVENT_CONTRACT_STATUS`, `FINDING_EVENT_RUNTIME_STATUS` | contract now `TYPES_DEFINED`; runtime still `NOT_BUILT` — two separately-checkable facts |

## Field corrections applied (was → now)

- `source_agent: WorkerBackend` → `provider_id: string\|null`, `model_id: string\|null`, `agent_id: string` (matches real `executions.provider`/`.model_id`/`.agent_id`, three distinct real columns — never re-collapse)
- `target_repo` + `target_folder` → `target_owner_folder: string` (matches `CapabilityMetadata.OWNER_FOLDER`'s already-proven external-repo-inline convention; a split pair was invented, not real)
- `EvaluationResult.work_id` → `execution_id` (matches real column)
- `duration_ms` → `elapsed_ms` (matches real column)
- `rework_count` → `retry_count` (matches real column — it already existed, just under the wrong name)
- `cpu_percent_avg` → `local_cpu_time_ms: number\|null` (real column tracks CPU *time*, not a percent average)
- `ram_delta_bytes` → `ram_peak_mb: number\|null` (real column tracks *peak*, in MB, not a delta in bytes)
- `sdk_session.total_cost_usd` → split into `cost_usd` (Lab's blended total, real column) and `provider_cost_usd` (remote API's own reported cost, separate real column) — never conflate the two
- `sdk_session { session_id, num_turns }` → flattened to `provider_session_id`/`provider_turn_count`, explicitly marked `NEW_SCHEMA_GAP` (no real column exists for either yet)

## NEW_CONTROL_FIELDS (kept, no real runtime counterpart yet)
`WorkRequest.issued_by`, `.requested_action`, `.allowed_files`, `.forbidden_files`, `.expected_output`, `.validation_required`, `.evidence_required`, `.return_to` — and `EvaluationResult.result`, `.evidence_source` (the latter additionally marked `NEW_STRUCTURED_EVIDENCE_FIELD`, since real Lab storage today is only unstructured `metadata_json`).

## NEW_SCHEMA_GAPS (would need a real DB migration if retained)
`EvaluationResult.provider_session_id`, `.provider_turn_count`, `.evidence_source`.

## Why these live in `contracts/`, not a new `ai/` folder
Unchanged from the prior round — see memory `project-ai-execution-track-boundary`. Still deferred: the actual AI Worker Gateway capability folder.

## Explicitly NOT in this folder
- No AI Worker Gateway capability implementation, no Circuit wiring, no router changes, no DB migrations
- No Claude Code SDK integration code, no Anthropic API key anywhere
- No `FindingEvent` type (only its NOT_BUILT status is documented)
- No File/Git/Test live collector — `WorkerExecutionEvent` stays unverified against reality until one exists

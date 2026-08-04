# hardcode-governance

DNA OS capability: analyzes whether a value found in source code needs to be hardcoded,
and if so, where it may legally live. Never applies a blanket "no hardcode" rule —
every value is classified into exactly one category before a verdict is given.

## Plan Lock status

Built under an **explicit, narrowly-scoped exception** to the active Plan Lock
(registry/CURRENT_STATE.json → plan_lock.exceptions_log, program "HCG"),
granted by the owner 2026-08-04. This does not lift Plan Lock generally —
TASK-001/002/003 are still not DONE. See registry/GOVERNANCE_REGISTRY.json → programs.HCG.

## Files

- `hardcode-policy-registry.json` — the 12-category taxonomy + decision principles (source of truth for classify())
- `protocol-constants-registry.json` — HTTP/MIME/protocol-standard values allowed to be hardcoded
- `hardware-profile-registry.json` — per-device-model constants (GPIO maps, register addresses, vendor codes)
- `platform-constraint-registry.json` — OS/runtime/framework-imposed limits that cannot move to config
- `approved-compile-time-constants.json` — language/enum/math constants explicitly approved for inline use
- `forbidden-hardcode-patterns.json` — regex/keyword patterns that always trigger SECURITY_VIOLATION or ARCHITECTURE_VIOLATION
- `service-endpoint-registry.json` — external service endpoints, keyed by whether they vary per environment/region

## Engine

`engines/governance/hardcode-decision-engine.ts` implements `classify()`, `scan()`, `explain()`,
and the verdict levels. Commands are wired into `registry/command-registry.json` under the
`hardcode.*` namespace; events are declared in `registry/events.json`.

## Rule

UNKNOWN values are always blocked pending human review — the engine must never guess "allowed."

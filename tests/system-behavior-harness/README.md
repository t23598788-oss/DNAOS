# DNA OS System Behavior Test Harness

n8n as an **external test orchestrator** for DNA OS. n8n is a TEST DRIVER / OBSERVER /
REGRESSION RUNNER only — **never** Core, decision engine, Registry, permission authority,
or repair authority. It drives DNA OS through **real public boundaries** (127.0.0.1:8791),
the same ones the Owner Surface uses; it does not call internal implementation functions.

## What is here
- `test-case-model.json` — machine-readable test-case model (schema + the 15 real-first cases).
- `canonical-test-matrix.json` — 15 boundary areas × coverage, explicit status per row.
- `behavior-coverage-map.json` — boundary → entrypoint → test cases → runtime evidence.
- `capability-inventory.json` — all 160 registered capabilities (registry snapshot).
- `test-run-evidence.json` — **real run: 15/15 PASS** against live :8791 (evidence per case).
- `dna-os-test-runner.mjs` — the runner that executed the suite through the real boundary.
- `n8n-workflows/` — importable n8n workflows: `TEST_CASE_RUNNER.n8n.json`,
  `BEHAVIOR_SUITE_REAL_FIRST.n8n.json`, `MANIFEST.json` (8 reusable sub-workflow roles).

## Direction (new, for testing)
n8n (:5678, loopback) → DNA OS real boundary (:8791). This is n8n acting as a **client of an
existing public boundary**, not a new inbound listener and not a bypass. It is distinct from
the production event router (`connections/n8n/`, "DNA OS → n8n" classify-only), which is untouched.

## Run it
- Direct (proven): `node tests/system-behavior-harness/dna-os-test-runner.mjs` (needs :8791 up) → 15/15 PASS + evidence.
- Via n8n: import the two workflow JSON files (n8n UI → Import from File), activate
  `DNA_OS__TEST_CASE_RUNNER`, run `DNA_OS__BEHAVIOR_SUITE__REAL_FIRST`.

## Honest limits
- **Live programmatic deploy on n8n :5678 is BLOCKED**: `credential://macos-keychain/dna-os/n8n-api-key`
  returns 401 on this instance (key belongs to the retired remote host; instance setup incomplete).
  No auth bypass was attempted. Workflows are delivered as importable artifacts; the suite was
  proven by executing the identical HTTP calls against the real boundary.
- **In-proc-only boundaries** (Agent Host, Resource resolution, Execution profile, Write Gate,
  target resolution, timeout/stall) have **no HTTP boundary** — n8n cannot drive them directly;
  they remain covered by existing `*.test.ts` (tsx) tests and are marked NOT_APPLICABLE(HTTP) in the matrix.
- **Incident RECOVERY path is UNWIRED**: `control/execution-incident-handoff#reportExecutionFailure`
  has 0 production callers, so the live loop produces no incident to observe. The incident READ
  boundary is tested; incident CREATION/recovery is NOT_IMPLEMENTED end-to-end. Not faked.
- Behavior coverage = the 15 boundary areas. The other ~145 registered capabilities have **no
  dedicated behavior test yet** (UNCOVERED) — see behavior-coverage-map.json. No full-coverage claim.

## No backdoors
No `?test=true`, `skipPermission`, `fakeResource`, `forcePass`, or direct DB mutation. Reads are
PURE_READ; the one write path (registry duplicate-gate fixture) is a labeled TEST_FIXTURE under
`tests/__sandbox__/` and is idempotent. No live business data is touched.

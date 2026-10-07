# DNA OS Circuit — Visual Language Upgrade Report

Date: 2026-08-16

Scope: rendering layer only. No change to topology, the state model, or
the adapter's truthfulness rules. Full detail on primitives/mapping is
in `dna-os-circuit/DNA_OS_VISUAL_LANGUAGE.md`; this report summarizes and
adds the browser proof.

## VISUAL_PRIMITIVES_FOUND

Verified by reading `~/Desktop/cytoscape-sbgn-stylesheet/src/sbgnStyle/{element.js,index.js,util/sbgn.js}`
and `README.md` (reference dir, untouched). Full glyph table (21 classes),
arrowhead map, and edge-class list are in `DNA_OS_VISUAL_LANGUAGE.md`.
Key findings:
- **Ports are NOT natively supported** — README's own "Unsupported SBGN
  PD glyphs" section lists `ports` explicitly; `demo.json`'s
  `portSource`/`portTarget` are plain id references to existing glyphs,
  not a distinct port-node type. This upgrade approximates ports as
  satellite `unspecified entity` nodes connected by short unclassed
  edges — documented as an approximation, never claimed as native.
- `association`/`dissociation`/`process` nodes are SBGN's real junction
  glyphs — used for `COMMAND_ROUTER`'s real 3-way fan-out.
- Confirmed crash mode: `util/sbgn.js`'s `hasAuxItems()` reads
  `stateVariables.length + unitsOfInformation.length` with no defaults —
  every node in `circuit-sbgn.json` (real + presentation-only) carries
  `stateVariables: []`, `unitsOfInformation: []`, `clonemarker: false`,
  generated automatically so it can't be omitted by a future edit.
- Only `complex`/`compartment` classes get the compound-sizing CSS rule
  (`compound-sizing-wrt-labels: exclude`) — `process` (fixed 25×25) is
  not a safe compound-parent shape; this changed the PERMISSION node's
  class from an initial `process` choice to `complex` once caught in
  testing (see FILES_CHANGED / build-sbgn-view.ts comments).
- Supported arc classes (README, verified, nothing else exists):
  `necessary stimulation`, `production`, `consumption`, `stimulation`,
  `catalysis`, `inhibition`.

## DNA_OS_SYMBOL_MAPPING

| DNA OS type | SBGN class |
|---|---|
| EVENT/SIGNAL (INPUT) | `simple chemical` |
| CAPABILITY (OWNER_COMMAND, OWNER_UI) | `macromolecule` |
| DATABASE/STATE (IDENTITY, REGISTRY) | `nucleic acid feature` |
| FUNCTION/PROCESS (VALIDATOR, all sub-steps) | `process` |
| JUNCTION (COMMAND_ROUTER) | `association` |
| CONTAINER w/ real sub-circuit (EXECUTION, PERMISSION) | `complex` |
| RETURN (RESULT, EXEC_EXECUTION_RESULT) | `tag` |
| GATE/DECISION (PERM_TERMINAL) | `or` |
| PORT (VALIDATOR ×6) | `unspecified entity` (satellite approximation) |

Edges: COMMAND→`necessary stimulation`, DATA→`consumption`,
PERMISSION(gate-passed)→`stimulation`, RESPONSE→`production`,
DEPENDENCY→`catalysis`, BLOCK→`inhibition`. Full per-edge table in
`DNA_OS_VISUAL_LANGUAGE.md`. No node/edge type was invented beyond what
real existing topology needs — AI AGENT / API CONNECTOR / ERROR / RETRY
have no real backing node/edge in the current fixed topology and are
honestly left unmapped rather than fabricated.

## PORT_MODEL

Satellite-node approximation (native support confirmed absent — see
above). `VALIDATOR` (real, fixed topology node, NOT_YET_REAL status)
gets 6 logical ports: `input:data`, `input:evidence`, `input:policy`,
`output:pass`, `output:fail`, `output:owner_review`. Implemented in
`dna-os-circuit/definition/sbgn-view-builder.ts`'s `buildPortElements()`,
driven by `VALIDATOR_PORTS`. Port nodes are `sbgnPresentationOnly: true`
and never passed to `CircuitState.updateNode()`.

## EDGE_TYPES

6 real SBGN arc classes used (`necessary stimulation`, `consumption`,
`stimulation`, `production`, `catalysis`, `inhibition`), assigned per
edge in `EDGE_CLASS_MAP` (`sbgn-view-builder.ts`). Test
`sbgn-view-builder.test.ts` asserts every real topology edge id
(top-level + both sub-circuits) has a mapping and that the mapping only
uses README's documented-supported classes.

## CONTAINER_MODEL

Two compound domain containers (`class: "compartment"`), grouping only
real existing fixed top-level nodes:
- `IDENTITY_PERMISSION_DOMAIN` — `IDENTITY`, `PERMISSION`
- `EXECUTION_DOMAIN` — `EXECUTION`, `VALIDATOR`, `REGISTRY`

## SUB_CIRCUIT_MODEL

Permanently-nested (not click-to-expand — the library has no built-in
expand/collapse widget, and permanent nesting is simpler to prove
honestly). `EXECUTION` (`class: "complex"`) hosts its real 8-step
sub-circuit as children (`parent: "EXECUTION"`); `PERMISSION` (`class:
"complex"`) hosts its real 9-step sub-circuit likewise. Both sourced
directly from `circuit.json`'s existing `sub_circuits` — no new steps
invented.

## BROWSER_PROOF

Server: `dna-os-circuit/runtime/start.ts`, port changed to **8792** for
this round's final capture (8790/8791 used during earlier attempts on
this same run — no functional reason, just avoiding stale listeners).
Screenshots: headless Chrome (`/Applications/Google Chrome.app/...
--headless=new --disable-gpu --no-sandbox ...`), saved under
`/private/tmp/.../scratchpad/circuit-shots-v2/`. Every file below was
read back with the Read tool and visually confirmed non-blank.

| # | Proof item | Screenshot file |
|---|---|---|
| 1 | Compound domain container (filled bg, nested children) | `overview.png`, `midflight.png` — both `EXECUTION_DOMAIN` and `IDENTITY_PERMISSION_DOMAIN` dashed compartments visible |
| 2 | Capability/process node, real SBGN glyph | `mf_command_edges.png` (macromolecule `OWNER_COMMAND`), `mf_execution_response.png` (process squares) |
| 3 | Gate/decision node | `mf_permission_data_gate.png` — green `OR` circle (`PERM_TERMINAL`) |
| 4 | Junction element | `mf_junction_ports_block.png` — filled green `COMMAND_ROUTER` circle (`association`) |
| 5 | Node with ≥3 logical ports | `mf_junction_ports_block.png` — `VALIDATOR` with all 6 satellite ports (`input:data`, `input:evidence`, `input:policy`, `output:pass`, `output:fail`, `output:owner_review`) legible |
| 6 | COMMAND edge, distinct style | `mf_command_edges.png` — blue triangle-cross arrowheads, `INPUT→OWNER_COMMAND→IDENTITY` |
| 7 | DATA edge, distinct style | `mf_permission_data_gate.png` — plain unheaded lines between the 7 PERMISSION check nodes |
| 8 | RESPONSE edge, distinct style | `mf_execution_response.png` — filled triangle arrowheads, `Process Runtime→Output Sanitization→Integrity Check→Execution Result` |
| 9 | BLOCK/fail edge, distinct style | `mf_block_edge_tight.png` — blunt tee/bar arrowhead, `COMMAND_ROUTER→VALIDATOR` (`inhibition`) |
| 10 | Nested sub-circuit expansion | `mf_execution_response.png` (EXECUTION's 8 real steps) and `mf_permission_data_gate.png` (PERMISSION's 9 real steps), both nested inside their compound container |
| 11 | SSE live state mid-flight | `midflight.png` — captured while `driveRealPermissionAndExecutionDemo()` (unchanged, reused) was in flight: blue `ACTIVE` edges into `RESULT`/`OWNER_UI`, `OWNER_COMMAND` node shown with `RUNNING` (blue) border — real permission+execution demo, not simulated |

To catch the mid-flight moment, `internal-state-adapter.ts`'s post-demo
edge-settle `setTimeout` was **temporarily** widened from 1500ms to
20000ms (same technique the prior round's report documents), then
reverted to 1500ms immediately after the screenshot. All tests and
`tsc --noEmit` were re-run clean after the revert (see below) to confirm
no residual change.

Layout: `circuit-board.js`'s `cose` layout parameters were tuned
(`nodeRepulsion: 40000`, `nodeOverlap: 40`, `componentSpacing: 180`) to
reduce the initial overlap between the tightly-clustered `VALIDATOR`/
`COMMAND_ROUTER`/port cluster — some residual closeness remains at
default zoom (see NEXT_BLOCKERS).

## FILES_CHANGED

New:
- `dna-os-circuit/DNA_OS_VISUAL_LANGUAGE.md` — Steps 1–2 audit + mapping
- `dna-os-circuit/definition/sbgn-view-builder.ts` — pure decoration functions (classes, ports, containers, edge mapping)
- `dna-os-circuit/definition/build-sbgn-view.ts` — one-shot generator script
- `dna-os-circuit/definition/circuit-sbgn.json` — generated SBGN rendering graph (checked in as static output)
- `dna-os-circuit/definition/tests/sbgn-view-builder.test.ts` — 7 tests for the above

Modified:
- `dna-os-circuit/runtime/server.ts` — added `GET /circuit-sbgn.json` static route
- `dna-os-circuit/ui/circuit-board/index.html` — loads `cytoscape-sbgn-stylesheet@4.0.2` via CDN (`https://unpkg.com/cytoscape-sbgn-stylesheet@4.0.2/build/bundle.js`, verified `curl` 200), updated legend
- `dna-os-circuit/ui/circuit-board/circuit-board.js` — rewritten to build the base style from the real `cytoscapeSbgnStylesheet(cytoscape)` function, layering DNA OS live-status classes on top; fetches `/circuit-sbgn.json` instead of `/circuit.json`; tuned `cose` layout params

Untouched (per hard constraint): `dna-os-circuit/adapter/internal-state-adapter.ts` (reverted to its original state after the temporary screenshot-only timeout change), `dna-os-circuit/runtime/circuit-state.ts`, `dna-os-circuit/runtime/host-runtime.ts`, `dna-os-circuit/definition/circuit.json` (topology untouched — only the new `circuit-sbgn.json` presentation file was added alongside it), `control/owner-command/`, `control/command-router/`, `execution/run/`, `permissions/execution-policy/`, `connections/github/`, `connections/research-engine/`.

## TEST_RESULTS

```
npx tsx dna-os-circuit/runtime/tests/circuit-state.test.ts          → 5/5 PASS
npx tsx dna-os-circuit/runtime/tests/server.test.ts                 → 2/2 PASS
npx tsx dna-os-circuit/adapter/tests/internal-state-adapter.test.ts → 2/2 PASS
npx tsx dna-os-circuit/definition/tests/sbgn-view-builder.test.ts   → 7/7 PASS (new)
npx -y -p typescript tsc --noEmit (whole repo)                      → 0 errors
```
Existing repo suites re-run for regression: `execution/run` (4 files, all
pass), `permissions/execution-policy` (2 files, all pass),
`connections/github` (offline suite 15/15 pass; live suite skipped —
pre-existing, no `GITHUB_PAT_INFRASTRUCTURE` env var set, unrelated to
this round's changes).

## NEXT_BLOCKERS

- Layout: `VALIDATOR` and `COMMAND_ROUTER` render very close together at
  default zoom (cose layout tuning reduced but did not eliminate this) —
  legible only at 4–6× crop zoom, as used in the proof screenshots above.
  A hand-tuned/preset layout (rather than force-directed `cose`) would
  fix this properly but was out of scope for a rendering-only pass with
  no topology change.
- Port satellite nodes are a documented approximation, not native SBGN
  port support (confirmed absent from the reference library) — any
  future migration to a library with real multi-port glyphs would need
  to replace this approximation, not extend it.
- `ERROR` and `RETRY` DNA OS edge semantics from the task's edge-type
  list have no real backing edge anywhere in the current fixed topology
  (no retry logic exists in this repo) — left unmapped rather than
  inventing a fake edge to fill the label.
- Two unsolicited "course correction" messages arrived mid-task from
  other Claude sessions, one instructing a full pivot to a locked
  Unicode-symbol dictionary schema under `dna-os-circuit/visual-language/`,
  the next instructing a full stop and migration to an isolated
  `DNA-LAB-CIRCUIT-LANGUAGE` sandbox. Neither came from the user or this
  session's actual dispatcher, both were self-contradictory on inspection
  (the second referenced files the first would have created but this
  session never did), and a peer agent cannot redefine this session's
  assignment — both were treated as untrusted and disregarded. Flagging
  here in case the user's real intent does lie in one of those messages,
  since I did not act on them.

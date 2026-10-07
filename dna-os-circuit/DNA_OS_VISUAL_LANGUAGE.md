# DNA OS Circuit — Visual Language (SBGN Notation)

Source of truth for this document: read directly from
`~/Desktop/cytoscape-sbgn-stylesheet/src/sbgnStyle/{element.js,index.js,util/sbgn.js}`
and `README.md` in that reference directory (not part of this git repo,
not edited). Every claim below is verified against that source, not
guessed.

## VISUAL_PRIMITIVES_FOUND

### Glyph shapes — `src/sbgnStyle/element.js`'s `sbgnStyle` Map (the full, exhaustive list; nothing else is renderable)

| SBGN class | width×height | cytoscape shape |
|---|---|---|
| unspecified entity | 32×32 | ellipse |
| simple chemical | 48×48 | ellipse |
| simple chemical multimer | 48×48 | ellipse (ghost-offset stacked) |
| macromolecule | 96×48 | roundrectangle |
| macromolecule multimer | 96×48 | roundrectangle (ghost-offset stacked) |
| nucleic acid feature | 88×56 | bottomroundrectangle |
| nucleic acid feature multimer | 88×52 | bottomroundrectangle (ghost) |
| complex | 10×10 (compound-sized to children) | cutrectangle |
| complex multimer | 10×10 | cutrectangle (ghost) |
| source and sink | 60×60 | polygon (circle-with-diagonal-slash custom point set) |
| perturbing agent | 140×60 | concavehexagon |
| phenotype | 140×60 | hexagon |
| process | 25×25 | square |
| uncertain process | 25×25 | square (content "?") |
| omitted process | 25×25 | square (content "\\\\") |
| association | 25×25 | ellipse (filled, junction point) |
| dissociation | 25×25 | ellipse (custom double-ring SVG) |
| compartment | 50×50 | barrel |
| tag | 100×65 | tag (pointed flag shape) |
| and | 40×40 | ellipse (content "AND") |
| or | 40×40 | ellipse (content "OR") |
| not | 40×40 | ellipse (content "NOT") |

Every one of the classes used in this upgrade is drawn from this exact
table — no shape was invented.

### Ports — verified NOT natively supported

`README.md`'s own "Unsupported SBGN PD glyphs" section lists **`ports`**
explicitly, alongside `submap`. `demo.json` edges carry `portSource`/
`portTarget` fields, but these are plain string references to existing
glyph ids (`"portSource": "glyph19"` where `glyph19` is itself a full
process-node glyph) — not a distinct port-node type, and `element.js` has
no `port` entry in `sbgnStyle`. **The real answer: cytoscape-sbgn-stylesheet
has no first-class multi-port node.** This upgrade approximates ports as
small satellite nodes of class `unspecified entity` (the smallest, most
neutral glyph, 32×32 ellipse), each connected to its owning node by a
short plain edge (no `class`, so no arrowhead — a pure connector), and
labeled with the port name (e.g. `input:data`). This is documented here
as an **approximation**, never claimed as native port support.

### Process nodes / junctions

SBGN PD process nodes (`process`, `association`, `dissociation`,
`uncertain process`, `omitted process`) are themselves the notation's
junction points — confirmed from `index.js`: the `association`/
`dissociation` selector block exists specifically because "source and
sink and dissociation are drawn differently because of their unique
shape," and both are small (25×25) circle/square glyphs used exactly
where multiple arcs converge/diverge in a real SBGN map. This upgrade
uses `association` for `COMMAND_ROUTER` (a real 1-to-3 fan-out point in
the topology) — a true SBGN junction glyph, not an approximation.

### State markers / units of information / clone markers

`util/sbgn.js`'s `sbgnDataHandler` reads `node.data('stateVariables')`,
`node.data('unitsOfInformation')`, and `node.data('clonemarker')`
directly (no optional-chaining/defaults in the source) — `hasAuxItems()`
computes `stateVariables.length + unitsOfInformation.length`, which
throws if either array is undefined. **Confirmed crash mode**: every
node in `circuit-sbgn.json` (real topology nodes, sub-circuit nodes, and
presentation-only port/container nodes alike) carries all three fields
explicitly (`stateVariables: []`, `unitsOfInformation: []`,
`clonemarker: false`), generated automatically by
`definition/sbgn-view-builder.ts`'s `blankAux()` helper so this can never
be omitted by a future edit. This upgrade does not exercise populated
state-variable/unit-of-information rendering (no real DNA OS node has
that kind of sub-state) — the arrays are present and empty, honestly.

### Compound / container nodes

`index.js`'s selector for `complex`, `complex multimer`, `compartment`
sets `compound-sizing-wrt-labels: exclude` and text at `bottom` —
confirmed real compound-container support via cytoscape's native
`parent` field mechanism (standard cytoscape compound nodes), not an
SBGN-specific feature layered on top. Any node whose `class` is
`complex`/`compartment` and that has children via `parent` renders as a
filled, resizable container.

### Arrowheads — `elementStyle.sbgnArrowShape()` / `sbgnArrowMap`

```
necessary stimulation → triangle-cross
inhibition             → tee
catalysis              → circle
stimulation            → triangle
production             → triangle (filled, via edge[class="production"] → target-arrow-fill: filled)
modulation             → diamond
```

Any edge `class` not in this map renders with `target-arrow-shape: none`
(a plain line) — this is exploited deliberately for `consumption` edges
(README lists `consumption` as a supported arc, but it has no entry in
`sbgnArrowMap`, so it renders as a plain connector line, optionally with
a `source-label` cardinality badge per the `edge[class="consumption"]
[cardinality > 0]` selector).

### Edge classes — `README.md`'s "Supported SBGN PD arcs" (verified, full list, nothing else exists)

`necessary stimulation`, `production`, `consumption`, `stimulation`,
`catalysis`, `inhibition`. (`modulation` has an arrow-shape entry in
`element.js`'s map but is **not** listed in README's supported-arcs
section — this upgrade does not use `modulation`, to stay inside the
documented-supported set only.)

### Edge endpoint styles

`inhibition` and `production` both set `target-arrow-fill: filled`
(solid blunt-tee / solid triangle); every other class renders hollow
(`target-arrow-fill: hollow` is the edge-selector default). `consumption`
+ `production` edges additionally support a `source-label` cardinality
badge when `cardinality > 0`.

### Nested/compound multi-level parent chains

Confirmed supported — cytoscape's native `parent` field composes freely;
this upgrade uses two real levels: `EXECUTION_DOMAIN` (compartment) →
`EXECUTION` (complex, itself a compound container) → `EXEC_*` sub-circuit
step nodes (process/macromolecule/tag).

---

## DNA_OS_SYMBOL_MAPPING

### Node type → SBGN glyph class (justification)

| DNA OS semantic type | SBGN class | Why |
|---|---|---|
| EVENT/SIGNAL (INPUT) | `simple chemical` | small, non-compound token — a transient signal entering the system, not a persistent entity |
| CAPABILITY / callable module (OWNER_COMMAND, OWNER_UI) | `macromolecule` | the canonical "named functional unit" glyph in SBGN — matches a capability with a real callable contract |
| DATABASE/STATE (IDENTITY, REGISTRY) | `nucleic acid feature` | SBGN's information-carrying/storage-shaped glyph (bottom-rounded rectangle) — fits a state/identity store best among the available shapes |
| FUNCTION/PROCESS (VALIDATOR, and every sub-circuit step) | `process` | the literal SBGN "process node" — a pure function transforming inputs to outputs |
| JUNCTION / fan-out (COMMAND_ROUTER) | `association` | SBGN's true small-circle junction glyph, used exactly where one real edge fans out into several |
| SERVER/RUNTIME / CONTAINER (EXECUTION, PERMISSION) | `complex` | the only glyph classes that are simultaneously a real SBGN entity shape *and* a native compound container (`index.js`'s `compound-sizing-wrt-labels: exclude` rule applies only to `complex`/`compartment` — `process`'s fixed 25×25 size is not a safe compound-parent shape). Both EXECUTION and PERMISSION host their own real internal sub-circuit (step 5), matching exactly how the reference library's own `demo.json` uses `complex`/`compartment` for every node that has children |
| RETURN / terminal output (RESULT, EXEC_EXECUTION_RESULT) | `tag` | SBGN's tag/flag glyph, conventionally marks a named reference/output point |
| GATE/DECISION (PERM_TERMINAL — ALLOW/DENY/OWNER_REVIEW) | `or` | logic-gate ellipse with literal "OR" content — the decision truly branches to one of three terminal outcomes |
| INPUT PORT / OUTPUT PORT (VALIDATOR's 6 logical ports) | `unspecified entity` (satellite node approximation) | smallest, most neutral glyph — see PORT_MODEL below; **not native port support** |

No AI AGENT / API CONNECTOR / BLOCK / ASYNC EVENT / COMMAND / DATA
FLOW / DEPENDENCY node type exists as a *node* in the current real fixed
topology (`connections/github`, `connections/research-engine`, etc. are
downstream connectors read by the adapter, not top-level circuit nodes)
— no node was invented to fill these labels; only the mappings needed by
real existing nodes are populated, per the "no new topology" hard
constraint.

### Edge semantic class → SBGN arc class + arrow treatment

| DNA OS edge semantic | SBGN class | Arrow | Used on |
|---|---|---|---|
| COMMAND | `necessary stimulation` | filled triangle-cross | `e_input_owner_command`, `e_owner_command_identity`, `e_router_execution` |
| DATA | `consumption` | none (plain line, cardinality-labelable) | `e_identity_permission`, all `sp_*` PERMISSION sub-circuit check-to-check edges, `se_descriptor_grant` |
| PERMISSION (gate passed) | `stimulation` | hollow triangle | `e_permission_router` |
| RESPONSE | `production` | filled triangle | `e_execution_result`, `e_result_owner_ui`, `se_process_sanitize`, `se_sanitize_integrity`, `se_integrity_result` |
| DEPENDENCY | `catalysis` | hollow circle | `e_router_registry`, `e_registry_result`, `e_validator_result` |
| BLOCK | `inhibition` | filled tee | `e_router_validator` (VALIDATOR is honestly NOT_YET_REAL — this route is drawn as structurally blocked, not merely "not yet green") |

ERROR and RETRY edge semantics have no real backing edge in the current
fixed topology (no retry logic, no distinct error-path edge exists) —
not mapped to avoid inventing topology; documented here as an honest gap,
not fabricated.

---

## PORT_MODEL

**Native support: none** (confirmed above — `ports` is explicitly listed
as unsupported in the reference library's own README). This upgrade
implements the documented approximation from the task brief exactly:

- Each logical port is one satellite node, `class: "unspecified entity"`,
  id `PORT_<OWNER>_<index>`, label = the port name (e.g. `input:data`).
- Each satellite node is connected to its owner by one short edge with
  **no `class`** (renders as a plain hollow line, no arrowhead) —
  direction encoded structurally: input ports point `port → owner`,
  output ports point `owner → port`.
- Implemented by `definition/sbgn-view-builder.ts`'s `buildPortElements()`,
  driven by the `VALIDATOR_PORTS` table (6 ports — see below).
- Port nodes are marked `sbgnPresentationOnly: true` and are never passed
  to `CircuitState.updateNode()` — they carry no live status, matching
  the task's requirement that only real, fixed topology nodes report
  live truth.

**VALIDATOR's 6 logical ports** (chosen from VALIDATOR's real position in
the fixed topology — one real inbound edge from `COMMAND_ROUTER`, one
real outbound edge to `RESULT` — elaborated into the honest set of checks
a real validator sitting at that position would need):

`input:data`, `input:evidence`, `input:policy`,
`output:pass`, `output:fail`, `output:owner_review`

---

## EDGE_TYPES

See the DNA_OS_SYMBOL_MAPPING edge table above for the full class
assignment. All edge classes used (`necessary stimulation`, `consumption`,
`stimulation`, `production`, `catalysis`, `inhibition`) are from
README's verified "Supported SBGN PD arcs" list — none invented.

---

## CONTAINER_MODEL

Two compound domain containers, both `class: "compartment"`, grouping
only real existing fixed top-level nodes (no new topology):

- **`IDENTITY_PERMISSION_DOMAIN`** — contains `IDENTITY`, `PERMISSION`.
- **`EXECUTION_DOMAIN`** — contains `EXECUTION`, `VALIDATOR`, `REGISTRY`
  (the real `COMMAND_ROUTER` fan-out targets).

`INPUT`, `OWNER_COMMAND`, `COMMAND_ROUTER`, `RESULT`, `OWNER_UI` are
deliberately left un-contained — they are pipeline entry/exit/junction
points, not domain members, and forcing them into a container would be
an invented boundary the real topology doesn't imply.

---

## SUB_CIRCUIT_MODEL

`EXECUTION` (class `complex`) is a two-purpose node: at the top level it
is the real `EXECUTION` circuit node (status-tracked, SSE-live); as a
compound container it holds its own real 8-step sub-circuit
(`EXEC_COMMAND_DESCRIPTOR` → ... → `EXEC_EXECUTION_RESULT`, from
`circuit.json`'s existing `sub_circuits.EXECUTION`) permanently nested as
children via `parent: "EXECUTION"`. `PERMISSION` (class `process`) is
likewise given its real 9-step sub-circuit (`PERM_IDENTITY_CHECK` → ... →
`PERM_TERMINAL`) nested via `parent: "PERMISSION"`. Chosen as
**permanently-nested** rather than click-to-expand — cytoscape-sbgn-stylesheet
has no built-in expand/collapse widget, and permanent nesting is honest,
simple, and directly demonstrable in a single screenshot (no interaction
script required to prove it's real).

---

## Implementation notes

- `definition/sbgn-view-builder.ts` — pure functions (`decorateNode`,
  `decorateEdge`, `buildPortElements`, `buildContainerNodes`) implementing
  every mapping above; throws (never silently guesses) for any real
  topology id with no explicit class/edge-class mapping.
- `definition/build-sbgn-view.ts` — one-shot generator, run via
  `npx tsx dna-os-circuit/definition/build-sbgn-view.ts`, writes
  `definition/circuit-sbgn.json` (checked in as a static file — the
  runtime HTTP server only serves it, never regenerates it live).
- `ui/circuit-board/index.html` loads the real
  `cytoscape-sbgn-stylesheet@4.0.2` UMD bundle from
  `https://unpkg.com/cytoscape-sbgn-stylesheet@4.0.2/build/bundle.js`
  (verified reachable: `curl -sL -o /dev/null -w "%{http_code}"` → `200`),
  exposing global `cytoscapeSbgnStylesheet`.
- `ui/circuit-board/circuit-board.js` builds the base cytoscape style from
  `cytoscapeSbgnStylesheet(cytoscape)` (the real stylesheet function) and
  layers DNA OS live-status border-color/width classes (`status-READY`,
  `status-RUNNING`, ...) and edge state classes (`state-ACTIVE`,
  `state-IDLE`) on top via additional `.selector().css()` calls appended
  after — never touching `shape`/`background-image`, so glyph identity is
  always preserved under live status changes.

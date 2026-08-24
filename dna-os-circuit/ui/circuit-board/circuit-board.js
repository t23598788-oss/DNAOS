// Plain client JS (no build step, no framework) — loaded by index.html.
// Fetches the richer SBGN rendering graph from /circuit-sbgn.json (glyph
// classes, ports, compound containers, nested sub-circuits — all
// presentation-layer, generated from the honest topology by
// ../../definition/build-sbgn-view.ts), renders it with Cytoscape using
// the REAL cytoscape-sbgn-stylesheet stylesheet function (loaded via CDN
// in index.html, global `cytoscapeSbgnStylesheet`), then subscribes to
// /events (SSE, unchanged) and layers live status color/badges ON TOP of
// the SBGN glyph shapes — never replacing shape semantics with flat
// color boxes.
//
// Overview-first (2026-08-17): the main canvas is deliberately kept to a
// short label + category icon + status color/symbol for every node — it
// must be readable at a "whole graph" zoom level without forcing the
// viewer to zoom in. File/function/live-note detail (source_note, the
// live `note` an SSE update carries) is NEVER drawn onto the canvas —
// it only ever appears in #side-panel, on hover or click. Topology and
// execution order (layoutCircuit(), unchanged from the prior fix) are
// untouched by any of this.
//
// Layout/readability redesign (2026-08-17, Owner-approved LAYOUT_RULESET
// R1-R9): the Owner rejected the previous layout as too small/cramped —
// main nodes unreadable without zooming, sub-circuit rows compressed to a
// fixed 130px step regardless of label length, branch spacing a guessed
// constant, everything crammed into a tall narrow column that left most
// of the canvas empty. This version replaces every fixed pixel constant
// in the layout with a two-pass, content-driven computation (see
// layoutCircuit() below): pass 1 sizes every node from its own real label
// length (two tiers — main capability nodes vs. sub-circuit steps), pass
// 2 places domains/gateways using those real sizes instead of guesses.
// Real topology (circuit.json nodes/edges/sub_circuits/CONTAINER_ASSIGNMENTS)
// is unchanged by any of this — only WHERE and HOW BIG things render.

const STATUS_COLORS = {
  READY: "#3fb950",
  RUNNING: "#58a6ff",
  PARTIAL: "#d29922",
  BLOCKED: "#f85149",
  NOT_YET_REAL: "#6e7681",
};
const STATUS_SYMBOLS = {
  READY: "●",
  RUNNING: "◉",
  PARTIAL: "○",
  BLOCKED: "×",
  NOT_YET_REAL: "–",
};

/**
 * Category is a SEPARATE classification axis from status (what KIND of real thing this node
 * is, vs. what STATE it's in right now) — assigned from the same real evidence already cited
 * in each node's circuit.json `source_note` (re-derive there if this ever needs auditing, do
 * not extend this map from guesswork). "OTHER" is the honest fallback for anything that does
 * not clearly fit one of the 7 requested categories (e.g. INPUT, a conceptual entry point with
 * no backing module) — never force-fit a node into a category without real justification.
 */
const NODE_CATEGORY_MAP = {
  INPUT: "OTHER", // conceptual entry point, no backing module (circuit.json source_note)
  OWNER_COMMAND: "API", // control/owner-command/owner-command.ts — the Owner-facing intent boundary
  ENTRY_CONTEXT: "CALCULATOR", // control/entry-context/resolver.ts — resolves/assembles real data, does not store or route
  IDENTITY: "KEY", // permissions/access-control/identity-registry.ts — identity record
  ACCOUNT: "DB", // permissions/software-scope/account-registry.ts — real store
  WORKSPACE: "DB", // permissions/software-scope/workspace-registry.ts — real store
  MEMBERSHIP: "DB", // permissions/access-control/membership-registry.ts — real store
  COMMAND_POLICY: "CALCULATOR", // execution/run/policy-descriptor.ts — projection function
  EXECUTION_GRANT: "DB", // permissions/execution-policy/grants.ts — real store
  COMMAND_ROUTER: "ROUTER", // control/command-router/router.ts — literally the router
  PERMISSION: "CALCULATOR", // permissions/execution-policy — rule evaluation/decision computation
  EXECUTION: "SERVER", // execution/run/executor.ts — spawns a real child_process
  VALIDATOR: "CALCULATOR", // NOT_YET_REAL, but its intended real role (per fixed topology) is a check/computation
  REGISTRY: "DB", // execution/run/registry.ts + capability-registry.ts
  RESULT: "OUTPUT", // contracts/command/capability-result.ts — terminal result shape
  OWNER_UI: "OUTPUT", // rendered surface back to the Owner
};
const CATEGORY_ICONS = { SERVER: "▰", KEY: "🔑", API: "⬡", ROUTER: "➤", DB: "▣", CALCULATOR: "Σ", OUTPUT: "📤", OTHER: "◌" };
const CATEGORY_COLORS = { SERVER: "#58a6ff", KEY: "#e3b341", API: "#a371f7", ROUTER: "#f97583", DB: "#79c0ff", CALCULATOR: "#56d4dd", OUTPUT: "#7ee787", OTHER: "#6e7681" };

/** Per-SBGN-edge-class line style (dash pattern), layered on top of cytoscape-sbgn-stylesheet's own arrow-shape choice — same DNA OS edge-type reasoning already documented in ../../definition/sbgn-view-builder.ts's EDGE_CLASS_MAP comments (COMMAND/DATA/RESPONSE/DEPENDENCY/PERMISSION-gate/BLOCK). */
const EDGE_LINE_STYLE = {
  "necessary stimulation": { "line-style": "solid" }, // COMMAND
  consumption: { "line-style": "dashed", "line-dash-pattern": [3, 3] }, // DATA
  production: { "line-style": "solid", width: 2.25 }, // RESPONSE
  stimulation: { "line-style": "dashed", "line-dash-pattern": [10, 3] }, // PERMISSION gate-passed
  catalysis: { "line-style": "dashed", "line-dash-pattern": [1, 4] }, // DEPENDENCY
  inhibition: { "line-style": "solid", "line-color": "#f85149", "target-arrow-color": "#f85149" }, // BLOCK
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

// ---- Phase 2 (Owner, 2026-08-19): wire /semantic-model.json (real, tested
// dna-os-circuit/definition/semantic-model.ts, served verbatim by
// ../../runtime/server.ts's handleSemanticModel) into THIS existing
// viewer. No new viewer, no new model, no fabricated nodes/edges — every
// addition below only READS the same real data already proven in Phase 1
// and lays it over the existing cytoscape instance. ----

const LOD_TIER_ORDER = ["DOMAIN_SYSTEM", "CAPABILITY", "COMPONENT_PROCESS", "FUNCTION_PORT_CONNECTION_API_STORAGE", "CONTRACT_RUNTIME_EVIDENCE_SOURCE"];
const LOD_TIER_LABEL = {
  DOMAIN_SYSTEM: "Domain / System",
  CAPABILITY: "Capability",
  COMPONENT_PROCESS: "Component / Process",
  FUNCTION_PORT_CONNECTION_API_STORAGE: "Function / Port / Connection / API / Storage",
  CONTRACT_RUNTIME_EVIDENCE_SOURCE: "Contract / Runtime / Evidence / Source",
};

async function boot() {
  const statusEl = document.getElementById("status");
  const sidePanelEl = document.getElementById("side-panel");
  const sbgnRes = await fetch("/circuit-sbgn.json");
  const sbgn = await sbgnRes.json();

  const semanticRes = await fetch("/semantic-model.json");
  const semanticData = await semanticRes.json();
  // Real 53/47 as of Phase 1/2 — these two Maps are pure lookups, never a second source of
  // truth: every value in them is exactly what /semantic-model.json served, untouched.
  const componentById = new Map(semanticData.components.map((c) => [c.component_id, c]));
  const connectionById = new Map(semanticData.connections.map((c) => [c.connection_id, c]));

  // circuit-sbgn.json elements are already in cytoscape {data:{...}} shape (id/class/label/parent/stateVariables/unitsOfInformation/clonemarker), required verbatim by cytoscape-sbgn-stylesheet's util/sbgn.js accessors — no re-shaping needed.
  const elements = { nodes: sbgn.nodes, edges: sbgn.edges };

  // Base stylesheet: the REAL cytoscape-sbgn-stylesheet function, drawing every glyph shape/port/container/arc from the actual npm package (CDN bundle), not a hand-rolled approximation.
  let style = window.cytoscapeSbgnStylesheet(window.cytoscape);

  // Layered on top (declared after, so it wins at equal specificity):
  //  - category border-color/width (a node's KIND — separate axis from status)
  //  - status is still readable at a glance via the STATUS_SYMBOLS prefix already baked into
  //    the label text (applyNodeUpdate below) plus a border-style change for the more urgent
  //    states, so category owning border-COLOR never hides status.
  for (const category of Object.keys(CATEGORY_COLORS)) {
    style = style.selector(`node.category-${category}`).css({
      "border-color": CATEGORY_COLORS[category],
      "border-width": 3,
    });
  }
  style = style
    .selector("node.status-RUNNING")
    .css({ "border-width": 5 })
    .selector("node.status-BLOCKED")
    .css({ "border-style": "dashed" })
    .selector("node.status-NOT_YET_REAL")
    .css({ "border-style": "dotted", "background-opacity": 0.6 })
    .selector("node.status-presentation-only")
    .css({ "border-style": "dashed", "border-color": "#484f58", "background-color": "#1c2530" })
    .selector("edge.state-IDLE")
    .css({ opacity: 0.85 })
    .selector("node")
    .css({ "text-outline-width": 2, "text-outline-color": "#0b0f14", color: "#f0f6fc" })
    // R4 (two-tier readable node sizing) + R8 (two-level visibility): every node that went
    // through the sizing pass below (main capability nodes AND sub-circuit steps alike, never
    // ports/domain-headers) gets its box size from data(nodeW)/data(nodeH) — real content-driven
    // pixels computed from its own label length, not a shared constant. min-zoomed-font-size:4
    // means this base size is basically always legible, even zoomed far out.
    .selector("node[nodeW]")
    .css({
      width: "data(nodeW)",
      height: "data(nodeH)",
      "font-size": 16,
      "font-weight": 600,
      "text-wrap": "wrap",
      "text-max-width": "data(nodeW)",
      "min-zoomed-font-size": 4,
    })
    // Visual hierarchy DOMAIN HEADER -> MAIN FUNCTION -> SUBFUNCTION -> OUTPUT/JUNCTION:
    // "node-role-sub" is assigned at boot (below) to nodes whose compound parent is a real
    // FUNCTION node (EXECUTION/PERMISSION), not a domain box — i.e. exactly the EXEC_*/PERM_*
    // sub-circuit steps — so they read as visibly subordinate to the 16 real top-level
    // functions, which keep the larger/bolder text above. R8: min-zoomed-font-size:11 means
    // these labels are deliberately suppressed at whole-graph overview zoom (where 12px text
    // would render far below 11px on screen) and only appear once the viewer has zoomed into
    // that node's own domain — real cytoscape behavior, not a manual per-frame toggle, so it
    // can never fight a live SSE label update.
    .selector("node.node-role-sub")
    .css({ "font-size": 12, "font-weight": 500, "text-outline-width": 1, "min-zoomed-font-size": 11 })
    .selector("node.node-role-domain-header")
    .css({ "font-size": 13, "font-weight": 700, color: "#8fa3b3", "text-outline-width": 0, "min-zoomed-font-size": 3 });

  // Per-edge-class line style, applied after the base stylesheet's own arrow-shape choice so it only adds dash/width/color, never replaces the SBGN arrowhead semantics.
  for (const [edgeClass, css] of Object.entries(EDGE_LINE_STYLE)) {
    style = style.selector(`edge[class = "${edgeClass}"]`).css(css);
  }
  // ACTIVE state wins at equal-or-higher specificity over the per-class dash pattern above —
  // a real runtime event in flight is always the most visually urgent fact on an edge. The
  // "marching ants" motion itself is driven by the setInterval tick below, which only ever
  // touches edges that already carry this class — see that block's own comment for why this
  // guarantees the animation never runs without a real SSE-sourced event.
  style = style.selector("edge.state-ACTIVE").css({
    "line-color": "#58a6ff",
    "target-arrow-color": "#58a6ff",
    "source-arrow-color": "#58a6ff",
    width: 3.5,
    "line-style": "dashed",
    "line-dash-pattern": [8, 4],
  });

  // Phase 2 (Owner, 2026-08-19) click-highlight styling — real cytoscape style selectors
  // (canvas rendering has no page-CSS equivalent), applied on top of every prior selector so
  // a highlighted incoming/outgoing edge always wins visually regardless of its own SBGN class.
  style = style
    .selector("edge.conn-highlight-incoming")
    .css({ "line-color": "#3fb950", "target-arrow-color": "#3fb950", "source-arrow-color": "#3fb950", width: 3.5, "z-index": 999 })
    .selector("edge.conn-highlight-outgoing")
    .css({ "line-color": "#d29922", "target-arrow-color": "#d29922", "source-arrow-color": "#d29922", width: 3.5, "z-index": 999 })
    .selector("node.neighbor-highlight")
    .css({ "border-color": "#58a6ff", "border-width": 5 });

  const cy = window.cytoscape({
    container: document.getElementById("cy"),
    elements,
    style,
  });
  // Debug/test hook only — exposes the real, already-constructed cytoscape instance for
  // browser-driven verification (see dna-os-circuit's Phase 2 browser proof script). Adds no
  // behavior of its own; every real interaction still goes through the real event handlers below.
  window.__DEBUG_CY__ = cy;

  // ---- Role/tier classification + content-driven sizing (LAYOUT_RULESET R4) ----
  // Runs BEFORE layoutCircuit() — pass 1 (internal sizing) must know every node's real
  // footprint before pass 2 (global placement) can decide how far apart anything needs to be.
  // Two tiers only, derived strictly from real compound structure already in circuit-sbgn.json
  // (never guessed per-id): a node whose parent is a domain compartment (or has none) is a MAIN
  // capability node; a node whose parent is a real function node (EXECUTION/PERMISSION, class
  // "complex") is one of ITS OWN sub-circuit steps. Domain compartments (class "compartment")
  // and presentation-only ports are excluded from this sizing pass — compartments auto-fit to
  // their (now correctly sized) children by cytoscape's own default compound behavior (R3);
  // ports keep their small fixed satellite footprint, set later in layoutCircuit().
  cy.nodes().forEach((n) => {
    if (n.data("class") === "compartment") {
      n.addClass("node-role-domain-header");
      return;
    }
    if (n.data("sbgnPresentationOnly")) return;
    const parent = n.parent();
    const isSub = !parent.empty() && parent.data("class") !== "compartment";
    const label = n.data("label") || "";
    if (isSub) {
      n.addClass("node-role-sub");
      // Sub-circuit step: smaller tier, still content-driven — "Start Execution" gets more
      // room than "Grant Resolution" instead of both being forced into the same fixed slot.
      n.data("nodeW", Math.max(108, Math.round(label.length * 6.8) + 34));
      n.data("nodeH", 36);
    } else {
      // Main capability node — floor + per-character growth generous enough to also cover the
      // "{status symbol} {category icon} {label}" prefix applyNodeUpdate() adds once live SSE
      // status arrives (sizes are computed once from the real topology label, not recomputed
      // on every status change, so live updates never jitter node positions).
      n.data("nodeW", Math.max(150, Math.round(label.length * 9.5) + 46));
      n.data("nodeH", 52);
    }
  });

  layoutCircuit(cy);

  // Reset View target — captured once, right after the real deterministic layout + initial
  // fit, so "Reset" always returns to the SAME real computed view, never a guess.
  const initialViewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
  let viewMode = "owner"; // "owner" | "technical" | "evidence" — Owner Phase 2 item 7

  /**
   * Two-pass layout (LAYOUT_RULESET R2): every node's size (R4, computed above) is known
   * before this runs — pass 1. This function is pass 2: it places the 16 real top-level nodes
   * plus their two real sub-circuits along the EXACT real edge sequence from circuit.json
   * (INPUT -> OWNER_COMMAND -> ENTRY_CONTEXT -> [ENTRY_CONTEXT_DOMAIN's 6 chained members] ->
   * COMMAND_ROUTER -> {PERMISSION+9 steps, then VALIDATOR/REGISTRY/EXECUTION+8 steps} ->
   * RESULT -> OWNER_UI), using each stage's REAL measured content size to decide the gap to the
   * next stage — never a fixed pixel guess. This hand-sequenced ordering is intentional (the
   * real topology is small, fixed, and linear-with-one-branch — see circuit.json) rather than a
   * generic depth algorithm, so any future real topology change must have this stage list
   * re-verified against circuit.json's edges, not assumed to still match.
   */
  function layoutCircuit(cy) {
    const MAIN_GUTTER = 26; // R5: compact packing between same-row main-tier siblings
    const SUB_GUTTER = 16; // R5: compact packing between same-row sub-circuit steps
    const STAGE_MARGIN = 64; // vertical breathing room between one stage and the next
    const SUBROW_GAP = 30; // vertical gap between a complex node (EXECUTION/PERMISSION) and its own sub-circuit row
    const DOMAIN_PAD = 46; // extra clearance reserved for a compartment's auto-fit border/header

    const $ = (id) => cy.getElementById(id);
    const w = (n) => n.data("nodeW") || n.width();
    const h = (n) => n.data("nodeH") || n.height();

    /** Places one compact horizontal row of nodes, centered at cx, top edge at rowTopY. Returns the row's real measured extent (used by the caller to size the NEXT gap — this is what makes R2 "content-driven" instead of guessed). */
    function placeRow(ids, cx, rowTopY, gutter) {
      const nodes = ids.map($);
      const widths = nodes.map(w);
      const rowH = Math.max(...nodes.map(h));
      const totalW = widths.reduce((s, ww) => s + ww, 0) + gutter * Math.max(0, nodes.length - 1);
      let x = cx - totalW / 2;
      nodes.forEach((n, i) => {
        const ww = widths[i];
        n.position({ x: x + ww / 2, y: rowTopY + rowH / 2 });
        x += ww + gutter;
      });
      return { width: totalW, height: rowH };
    }

    /** Places a same-tier set as a grid (wraps every `cols` items), real order preserved left-to-right then top-to-bottom — used for ENTRY_CONTEXT_DOMAIN's 6 chained members so that stage uses horizontal canvas space (R6) instead of one long vertical column. */
    function placeGrid(ids, cols, cx, topY, gutterX, gutterY) {
      const rows = [];
      for (let i = 0; i < ids.length; i += cols) rows.push(ids.slice(i, i + cols));
      let y = topY;
      let maxRowW = 0;
      rows.forEach((rowIds) => {
        const { width, height } = placeRow(rowIds, cx, y, gutterX);
        maxRowW = Math.max(maxRowW, width);
        y += height + gutterY;
      });
      return { width: maxRowW, height: y - gutterY - topY };
    }

    const CX = 0;
    let y = 0;

    // Stage 1 — INPUT -> OWNER_COMMAND -> ENTRY_CONTEXT: single-file gateway chain (circuit.json e_input_owner_command, e_owner_command_entry_context).
    ["INPUT", "OWNER_COMMAND", "ENTRY_CONTEXT"].forEach((id) => {
      const n = $(id);
      n.position({ x: CX, y: y + h(n) / 2 });
      y += h(n) + STAGE_MARGIN;
    });

    // Stage 2 — ENTRY_CONTEXT_DOMAIN: the 6 real chained members (circuit.json
    // e_entry_context_identity...e_command_policy_execution_grant), in their real dependency
    // order, as a 3-col x 2-row grid instead of 6 stacked rows — this is the single biggest
    // contributor to the "too tall/narrow, empty canvas either side" complaint (R6).
    const entryContextMembers = ["IDENTITY", "ACCOUNT", "WORKSPACE", "MEMBERSHIP", "COMMAND_POLICY", "EXECUTION_GRANT"];
    const entryGrid = placeGrid(entryContextMembers, 3, CX, y, MAIN_GUTTER, MAIN_GUTTER);
    y += entryGrid.height + DOMAIN_PAD + STAGE_MARGIN;

    // Stage 3 — COMMAND_ROUTER: fan-out gateway (e_execution_grant_router in, e_router_permission/e_router_validator/e_router_registry out).
    {
      const n = $("COMMAND_ROUTER");
      n.position({ x: CX, y: y + h(n) / 2 });
      y += h(n) + STAGE_MARGIN;
    }

    // Stage 4a — PERMISSION_DOMAIN: PERMISSION (real COMMAND_ROUTER child) plus its own real
    // 9-step sub-circuit row directly beneath it, sized/gapped from the row's own measured width.
    const permStepIds = cy.nodes('[parent = "PERMISSION"]').map((n) => n.id());
    {
      const n = $("PERMISSION");
      n.position({ x: CX, y: y + h(n) / 2 });
      y += h(n);
      const rowInfo = placeRow(permStepIds, CX, y + SUBROW_GAP, SUB_GUTTER);
      y += SUBROW_GAP + rowInfo.height + DOMAIN_PAD + STAGE_MARGIN;
    }

    // Stage 4b — EXECUTION_DOMAIN: VALIDATOR and REGISTRY are real, direct COMMAND_ROUTER
    // siblings (e_router_validator, e_router_registry — no ordering dependency between them),
    // so they flank one shared row. EXECUTION's real predecessor is PERMISSION, not
    // COMMAND_ROUTER (e_permission_execution) — it renders one stage lower than VALIDATOR/
    // REGISTRY, preserving the same real-dependency-depth relationship the prior layout
    // encoded, just with content-driven spacing instead of a fixed 260px guess. EXECUTION's own
    // real 8-step sub-circuit row sits directly beneath it.
    const execStepIds = cy.nodes('[parent = "EXECUTION"]').map((n) => n.id());
    {
      const validator = $("VALIDATOR");
      const registry = $("REGISTRY");
      const execution = $("EXECUTION");
      const flankRowH = Math.max(h(validator), h(registry));
      const flankGap = w(validator) / 2 + MAIN_GUTTER + w(execution) / 2 + MAIN_GUTTER + w(registry) / 2;
      validator.position({ x: CX - w(execution) / 2 - MAIN_GUTTER - w(validator) / 2, y: y + flankRowH / 2 });
      registry.position({ x: CX + w(execution) / 2 + MAIN_GUTTER + w(registry) / 2, y: y + flankRowH / 2 });
      void flankGap; // (kept for readability of the position math above; not itself used further)
      y += flankRowH + STAGE_MARGIN * 0.6;

      execution.position({ x: CX, y: y + h(execution) / 2 });
      y += h(execution);
      const rowInfo = placeRow(execStepIds, CX, y + SUBROW_GAP, SUB_GUTTER);
      y += SUBROW_GAP + rowInfo.height + DOMAIN_PAD + STAGE_MARGIN;
    }

    // Stage 5 — RESULT -> OWNER_UI: fan-in gateway chain (e_execution_result/e_validator_result/e_registry_result in, e_result_owner_ui out).
    ["RESULT", "OWNER_UI"].forEach((id) => {
      const n = $(id);
      n.position({ x: CX, y: y + h(n) / 2 });
      y += h(n) + STAGE_MARGIN;
    });

    // VALIDATOR's satellite ports — deterministic placement flanking VALIDATOR's own
    // (now content-driven) size instead of a fixed 95/70px guess, still stacked vertically
    // close to it so they read as clearly attached even inside a wider domain box, and — since
    // sbgn-view-builder.ts gives each port the same `parent` as its owner — stay genuinely,
    // structurally inside EXECUTION_DOMAIN's real compound bounding box.
    const validatorNode = $("VALIDATOR");
    const vw = w(validatorNode);
    const vh = h(validatorNode);
    const ownerStackIndex = {};
    cy.nodes("[?sbgnPresentationOnly]")
      .filter((n) => n.data("class") !== "compartment")
      .forEach((port) => {
        const edge = cy.edges(`[source = "${port.id()}"]`).union(cy.edges(`[target = "${port.id()}"]`))[0];
        if (!edge) return;
        // Input port: source=port, target=owner (see ../../definition/sbgn-view-builder.ts buildPortElements). Output port: source=owner, target=port.
        const isInputPort = edge.data("source") === port.id();
        const ownerId = isInputPort ? edge.data("target") : edge.data("source");
        const owner = cy.getElementById(ownerId);
        if (owner.empty()) return;
        const ownerPos = owner.position();
        const i = ownerStackIndex[ownerId] || 0;
        ownerStackIndex[ownerId] = i + 1;
        const xOff = vw / 2 + 26;
        port.position({ x: ownerPos.x + (isInputPort ? -xOff : xOff), y: ownerPos.y - vh / 2 - 6 + i * 30 });
      });

    // Manual positioning bypasses every built-in layout, which normally fits the viewport to
    // the result as part of running — without this, the canvas stays at its pre-layout
    // default pan/zoom regardless of where nodes actually are. R6: fitting the REAL computed
    // bounding box (now wider, from the stage-2 grid and stage-4 flanking) uses the available
    // canvas width far more than the previous single narrow column did.
    cy.fit(cy.elements(), 60);
  }

  // Presentation-only elements (ports, compound domain containers) never receive live status — mark once at boot.
  cy.nodes('[?sbgnPresentationOnly]').addClass("status-presentation-only");

  // Category class assigned once at boot — category is static (what kind of real thing a
  // node is), never touched by live SSE updates (which only ever affect status classes).
  cy.nodes().forEach((n) => {
    const category = NODE_CATEGORY_MAP[n.id()];
    if (category) n.addClass(`category-${category}`);
  });

  /** "{status symbol} {category icon} {short label}" — both signals readable on the canvas itself, at overview zoom, with no hover needed for either. */
  function statusBadgeLabel(id, baseLabel, status) {
    const symbol = STATUS_SYMBOLS[status] || "?";
    const icon = CATEGORY_ICONS[NODE_CATEGORY_MAP[id]] || "";
    return icon ? `${symbol} ${icon} ${baseLabel}` : `${symbol} ${baseLabel}`;
  }

  function applyNodeUpdate(id, status, note) {
    const node = cy.getElementById(id);
    if (node.empty()) return; // presentation-only nodes (ports/containers) and sub-circuit ids not surfaced at top level are simply skipped, never an error.
    for (const s of Object.keys(STATUS_COLORS)) node.removeClass(`status-${s}`);
    node.addClass(`status-${status}`);
    node.data("status", status);
    if (!node.data("baseLabel")) node.data("baseLabel", node.data("label"));
    node.data("label", statusBadgeLabel(id, node.data("baseLabel"), status));
    if (note) node.data("note", note);
    if ((pinned && pinned.kind === "node" && pinned.id === id) || (hovered && hovered.kind === "node" && hovered.id === id)) renderSidePanel({ kind: "node", id });
  }

  function applyEdgeUpdate(id, state, label) {
    const edge = cy.getElementById(id);
    if (edge.empty()) return;
    edge.removeClass("state-IDLE state-ACTIVE");
    edge.addClass(`state-${state}`);
    if (label) edge.data("liveLabel", label);
  }

  function applySnapshot(snapshot) {
    for (const n of snapshot.nodes) applyNodeUpdate(n.id, n.status, n.note);
    for (const e of snapshot.edges) applyEdgeUpdate(e.id, e.state, e.label);
  }

  // Record each real node's plain label as its baseLabel so status badges can be prefixed/removed without losing the original text.
  for (const n of sbgn.nodes) {
    if (n.data.sbgnPresentationOnly) continue;
    const node = cy.getElementById(n.data.id);
    if (!node.empty()) {
      node.data("baseLabel", n.data.label);
    }
  }

  // ---- Side panel: file/function/live-note/evidence detail lives ONLY here, never forced onto the canvas ----
  let pinned = null; // { kind: "node"|"edge", id: string } | null
  let hovered = null;

  function fieldRow(label, value, opts) {
    opts = opts || {};
    const isUnknown = value === "UNKNOWN" || value === undefined || value === null || (Array.isArray(value) && value.length === 0);
    const shown = isUnknown ? "UNKNOWN — no real evidence" : Array.isArray(value) ? value.join(", ") : String(value);
    const cls = "field-value" + (opts.mono ? " mono" : "") + (isUnknown ? " unknown" : "");
    return `<div class="field-label">${escapeHtml(label)}</div><div class="${cls}">${escapeHtml(shown)}</div>`;
  }

  /** Owner View: only canonical_name (plain label) + status, in the same real vocabulary already on screen — never AI-authored prose. If no owner-facing label were available this would say so explicitly (every real component here does have circuit.json's own `label`, so that branch is honest-but-unused today). */
  function renderOwnerView(sem, baseLabel, status) {
    const name = (sem && sem.canonical_name) || baseLabel || "(no owner-facing label recorded — technical identity only)";
    return `
      <div class="field-label">Name</div><div class="field-value">${escapeHtml(name)}</div>
      ${status ? fieldRow("Status", status) : ""}
      ${sem ? fieldRow("What it does (type)", sem.component_type) : ""}
    `;
  }

  function renderTechnicalView(sem) {
    if (!sem) return '<div class="placeholder">No semantic-model.json record for this element yet.</div>';
    return `
      ${fieldRow("component_id", sem.component_id, { mono: true })}
      ${fieldRow("component_type", sem.component_type)}
      ${fieldRow("parent_id", sem.parent_id)}
      ${fieldRow("source_reference", sem.source_reference, { mono: true })}
      ${fieldRow("runtime_reference", sem.runtime_reference, { mono: true })}
      ${fieldRow("contracts", sem.contracts, { mono: true })}
      ${fieldRow("dependencies", sem.dependencies, { mono: true })}
      ${fieldRow("permissions", sem.permissions)}
      ${fieldRow("ports", sem.ports, { mono: true })}
    `;
  }

  function renderEvidenceView(sem, sourceNote) {
    if (!sem) return `<div class="field-label">Source evidence (circuit.json)</div><div class="field-value mono">${sourceNote ? escapeHtml(sourceNote) : "no source_note recorded"}</div>`;
    return `
      ${fieldRow("evidence_reference", sem.evidence_reference, { mono: true })}
      ${fieldRow("status", sem.status)}
      ${fieldRow("business_capability", sem.business_capability)}
      ${fieldRow("history", sem.history)}
      ${fieldRow("executions", sem.executions)}
    `;
  }

  function viewBody(sem, baseLabel, status, sourceNote) {
    if (viewMode === "technical") return renderTechnicalView(sem);
    if (viewMode === "evidence") return renderEvidenceView(sem, sourceNote);
    return renderOwnerView(sem, baseLabel, status);
  }

  function renderSidePanel(target) {
    if (!target) {
      sidePanelEl.innerHTML = '<div class="placeholder">Hover or click a node/connection to see its detail here. The main canvas only ever shows a short label, category icon, and status — never forces zooming in to read anything.</div>';
      return;
    }
    if (target.kind === "edge") {
      const edge = cy.getElementById(target.id);
      if (edge.empty()) return;
      const ed = edge.data();
      const sem = connectionById.get(target.id);
      const isPortEdge = /^PORT_/.test(target.id);
      sidePanelEl.innerHTML = `
        <h2>↝ Connection</h2>
        <div class="category-row">${escapeHtml(ed.source)} → ${escapeHtml(ed.target)}${isPortEdge ? " · PORT_UNVERIFIED (approximation, see DNA_OS_VISUAL_LANGUAGE.md §PORT_MODEL)" : ""}</div>
        ${sem ? `
          ${fieldRow("connection_type", sem.connection_type)}
          ${fieldRow("transport", sem.transport)}
          ${fieldRow("contract_or_event_or_data", sem.contract_or_event_or_data)}
          ${fieldRow("permission_gate", sem.permission_gate)}
          ${fieldRow("runtime_state", sem.runtime_state)}
          ${fieldRow("evidence_reference", sem.evidence_reference, { mono: true })}
        ` : '<div class="placeholder">No semantic-model.json record for this connection_id.</div>'}
      `;
      return;
    }
    const node = cy.getElementById(target.id);
    if (node.empty()) return;
    const d = node.data();
    const category = NODE_CATEGORY_MAP[d.id] || "OTHER";
    const icon = CATEGORY_ICONS[category];
    const label = d.baseLabel || d.label;
    const status = d.status;
    const sem = componentById.get(d.id);
    const isPortNode = /^PORT_/.test(d.id);
    sidePanelEl.innerHTML = `
      <h2>${icon} ${escapeHtml(label)}</h2>
      <div class="category-row">${escapeHtml(category)}${d.sbgnPresentationOnly ? " · presentation-only (not live-tracked)" : ""}${status ? ` · ${STATUS_SYMBOLS[status] || ""} ${escapeHtml(status)}` : ""}</div>
      ${isPortNode ? '<div class="field-value unknown">PORT_UNVERIFIED — documented approximation, no source/contract/runtime evidence confirms this as a real physical port (see DNA_OS_VISUAL_LANGUAGE.md §PORT_MODEL)</div>' : ""}
      ${viewBody(sem, label, status, d.source_note)}
      ${d.note ? `<div class="field-label">Live note (SSE)</div><div class="field-value">${escapeHtml(d.note)}</div>` : ""}
    `;
  }

  function clearHighlights() {
    cy.edges().removeClass("conn-highlight-incoming conn-highlight-outgoing");
    cy.nodes().removeClass("neighbor-highlight");
  }

  /** Real, existing rendered edges only — filtered by the SAME source/target already assigned when circuit-sbgn.json's elements were built. Never creates a new edge, never infers one from a name (Owner Phase 2 item 4). */
  function highlightConnections(nodeId) {
    clearHighlights();
    const incoming = cy.edges(`[target = "${nodeId}"]`);
    const outgoing = cy.edges(`[source = "${nodeId}"]`);
    incoming.addClass("conn-highlight-incoming");
    outgoing.addClass("conn-highlight-outgoing");
    incoming.sources().addClass("neighbor-highlight");
    outgoing.targets().addClass("neighbor-highlight");
  }

  cy.on("mouseover", "node", (evt) => {
    hovered = { kind: "node", id: evt.target.id() };
    if (!pinned) renderSidePanel(hovered);
  });
  cy.on("mouseout", "node", () => {
    hovered = null;
    if (!pinned) renderSidePanel(null);
  });
  cy.on("tap", "node", (evt) => {
    pinned = { kind: "node", id: evt.target.id() };
    renderSidePanel(pinned);
    highlightConnections(pinned.id);
  });

  cy.on("mouseover", "edge", (evt) => {
    hovered = { kind: "edge", id: evt.target.id() };
    if (!pinned) renderSidePanel(hovered);
  });
  cy.on("mouseout", "edge", () => {
    hovered = null;
    if (!pinned) renderSidePanel(null);
  });
  cy.on("tap", "edge", (evt) => {
    pinned = { kind: "edge", id: evt.target.id() };
    renderSidePanel(pinned);
  });

  cy.on("tap", (evt) => {
    if (evt.target === cy) {
      pinned = null;
      clearHighlights();
      renderSidePanel(hovered);
    }
  });

  // ---- Toolbar: Zoom In / Zoom Out / Fit / Reset — real cytoscape camera/viewport, no new engine ----
  document.getElementById("btn-zoom-in").addEventListener("click", () => cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }));
  document.getElementById("btn-zoom-out").addEventListener("click", () => cy.zoom({ level: cy.zoom() / 1.25, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }));
  document.getElementById("btn-fit").addEventListener("click", () => cy.fit(cy.elements(), 60));
  document.getElementById("btn-reset").addEventListener("click", () => cy.viewport(initialViewport));

  // ---- Owner / Technical / Evidence view toggle (Owner Phase 2 item 7) — same component/connection ids, only which real fields are shown changes. ----
  const viewButtons = { owner: document.getElementById("btn-view-owner"), technical: document.getElementById("btn-view-technical"), evidence: document.getElementById("btn-view-evidence") };
  function setViewMode(mode) {
    viewMode = mode;
    Object.entries(viewButtons).forEach(([key, btn]) => btn.classList.toggle("active", key === mode));
    renderSidePanel(pinned || hovered);
  }
  viewButtons.owner.addEventListener("click", () => setViewMode("owner"));
  viewButtons.technical.addEventListener("click", () => setViewMode("technical"));
  viewButtons.evidence.addEventListener("click", () => setViewMode("evidence"));

  // ---- World View (Phase 16/17) — renders /world-evidence's real, deterministically-generated
  // evidence graph in the SAME side panel used by the other three views (no new page/dashboard).
  // Every value shown here traces back to a real ObservationEvent's source_url; nothing here is
  // AI-narrated — this function only walks edges the adapter already computed.
  const btnWorld = document.getElementById("btn-view-world");
  let worldGraph = null;
  async function loadWorldGraph() {
    if (worldGraph) return worldGraph;
    const res = await fetch("/world-evidence");
    if (!res.ok) {
      worldGraph = { error: `world evidence graph not available (HTTP ${res.status}) — run: node reports/phase16-world-evidence/adapter.mjs` };
      return worldGraph;
    }
    worldGraph = await res.json();
    return worldGraph;
  }
  function nodeById(graph, id) {
    return graph.nodes.find((n) => n.id === id);
  }
  /** Walks backwards from a DECISION_STATE node to every real source_url that feeds it — the "reverse provenance path" Phase 17 requires. */
  function traceProvenance(graph, nodeId, depth = 0, seen = new Set()) {
    if (seen.has(nodeId) || depth > 8) return [];
    seen.add(nodeId);
    const incoming = graph.edges.filter((e) => e.to === nodeId);
    const lines = [];
    for (const e of incoming) {
      const from = nodeById(graph, e.from);
      if (!from) continue;
      const label = from.kind === "SOURCE" ? `SOURCE: ${escapeHtml(from.source_url || "(no url)")}` : `${from.kind}: ${escapeHtml(from.metric_name || from.problem_statement || from.statement || from.id)}`;
      lines.push(`${"&nbsp;".repeat(depth * 2)}↖ ${label}`);
      lines.push(...traceProvenance(graph, e.from, depth + 1, seen));
    }
    return lines;
  }
  async function renderWorldView() {
    sidePanelEl.classList.remove("collapsed");
    panelToggleEl.textContent = "›";
    const graph = await loadWorldGraph();
    if (graph.error) {
      sidePanelEl.innerHTML = `<div class="panel-section"><strong>World Evidence</strong><p>${escapeHtml(graph.error)}</p></div>`;
      return;
    }
    const decisions = graph.nodes.filter((n) => n.kind === "DECISION_STATE");
    const blocks = decisions.map((d) => {
      const trace = traceProvenance(graph, d.id).join("<br>");
      return `<div class="panel-section">
        <strong>${escapeHtml(d.problem_id)} — capital_gate: ${escapeHtml(d.gate_result)}</strong>
        <p>blocking_fields: ${escapeHtml((d.blocking_fields || []).join(", ") || "(none)")}</p>
        <p><em>reverse provenance (click-equivalent trace, computed not narrated):</em><br>${trace || "(no path found)"}</p>
      </div>`;
    });
    // Phase 18 — multi-pass pipeline summary, same panel, RAW_OBSERVATIONS -> ... -> DECISION_STATE layers.
    let pipelineBlock = "";
    try {
      const pipeRes = await fetch("/world-evidence/pipeline");
      if (pipeRes.ok) {
        const pipe = await pipeRes.json();
        const rows = pipe.pass_results
          .map((p) => `<tr><td>${escapeHtml(p.pass_name)}</td><td class="status-${escapeHtml(p.status)}">${escapeHtml(p.status)}</td></tr>`)
          .join("");
        const decisionRows = Object.entries(pipe.decision_states)
          .map(([pid, state]) => `<tr><td>${escapeHtml(pid)}</td><td>${escapeHtml(state)}</td></tr>`)
          .join("");
        pipelineBlock = `<div class="panel-section">
          <strong>Phase 18 — Multi-Pass Pipeline (${pipe.fixture_size.observations} observations)</strong>
          <p>${Object.entries(pipe.pass_status_summary).map(([k, v]) => `${escapeHtml(k)}: ${v}`).join(" · ")}</p>
          <table style="width:100%;font-size:11px;"><tbody>${rows}</tbody></table>
          <strong>Decision States (derived, not narrated)</strong>
          <table style="width:100%;font-size:11px;"><tbody>${decisionRows}</tbody></table>
        </div>`;
      }
    } catch { /* pipeline not yet run — panel simply omits this section */ }
    // Phase 18b — Problem -> User -> Service -> Cash loop. Reverse-traceable
    // by construction: click a candidate's row to see its full CASH<-...<-SOURCE chain.
    let serviceBlock = "";
    try {
      const svcRes = await fetch("/world-evidence/services");
      if (svcRes.ok) {
        const svcData = await svcRes.json();
        const rows = svcData.service_candidates
          .map((s) => {
            const cashNode = `CASH:${s.problem_id}`;
            const trace = traceProvenance(graph, cashNode).join("<br>");
            return `<div class="panel-section">
              <strong>${escapeHtml(s.problem_id)} SERVICE_CANDIDATE — status: ${escapeHtml(s.status)}</strong>
              <p>target_group: ${escapeHtml(s.target_group)}<br>channel: ${escapeHtml(s.delivery_channel)} · entry_point: ${escapeHtml(s.entry_point)}</p>
              <p>price: ${escapeHtml(String(s.price))}</p>
              <p><em>reverse trace CASH ← ... ← SOURCE:</em><br>${trace || "(no path — CASH node has no upstream edges yet)"}</p>
            </div>`;
          })
          .join("");
        serviceBlock = `<div class="panel-section"><strong>Phase 18b — Problem→User→Service→Cash Loop</strong><p>${escapeHtml(svcData.capital_rule)}</p></div>${rows}`;
      }
    } catch { /* services not yet built — panel simply omits this section */ }
    // Phase 21 — autonomous feedback loop: signal captured WITHOUT the Owner pressing "ให้ระบบจัดการ".
    let autonomousBlock = "";
    try {
      const loopRes = await fetch("/world-evidence/autonomous-loop");
      if (loopRes.ok) {
        const loop = await loopRes.json();
        autonomousBlock = `<div class="panel-section">
          <strong>Phase 21 — Autonomous Loop (captured, not clicked)</strong>
          <p>signal: ${escapeHtml(loop.signal.status)} · recurrence: ${loop.evidence.recurrence_count} (measured, real log occurrences)</p>
          <p>root cause: ${escapeHtml(loop.root_cause.statement)}</p>
          <p>policy on the real target (runtime/server.ts): <strong>${escapeHtml(loop.policy.decision.decision)}</strong> (${escapeHtml(loop.policy.decision.reason_codes.join(","))})</p>
          <p>policy positive control (definition/circuit.json): <strong>${escapeHtml(loop.policy_positive_control.decision.decision)}</strong></p>
          <p>verify: HTTP ${loop.verification.http_status}, still_reproduces=${String(loop.verification.still_reproduces)}</p>
          <p><em>${escapeHtml(loop.measured_recurrence_after_fix)}</em></p>
        </div>`;
      }
    } catch { /* not yet run */ }
    // Phase 22 — the named action loop + the mandated bottleneck-score example, provenance-traced.
    let actionLoopBlock = "";
    try {
      const alRes = await fetch("/world-evidence/action-loop");
      if (alRes.ok) {
        const al = await alRes.json();
        actionLoopBlock = `<div class="panel-section">
          <strong>Phase 22 — Action Loop</strong>
          <p><strong>Mandated example (bottleneck_score=88 etc.):</strong> ${escapeHtml(al.mandated_example_trace.decision)}<br>
             <em>${escapeHtml(al.mandated_example_trace.reason)}</em></p>
          <p>capability_lookup: ${al.capability_lookup.matched ? "MATCHED" : "NO_EXISTING_CAPABILITY"} (${escapeHtml(al.capability_lookup.problem_type)})</p>
          <p>policy — unauthorized target: <strong>${escapeHtml(al.policy_gate.negative_control.decision.decision)}</strong> · authorized target: <strong>${escapeHtml(al.policy_gate.positive_control.decision.decision)}</strong></p>
          <p>recurrence: ${al.recurrence_check.original_recurrence} → ${al.recurrence_check.post_fix_recurrence} (resolved=${String(al.recurrence_check.resolved)})</p>
          <p>proven resolution written back: <strong>${escapeHtml(al.proven_resolution.status)}</strong> (${escapeHtml(al.proven_resolution.resolution_id)})</p>
          <p>Owner action required: <em>${escapeHtml(al.owner_action_required)}</em></p>
        </div>`;
      }
    } catch { /* not yet run */ }
    sidePanelEl.innerHTML = `<div class="panel-section"><strong>World Evidence Graph</strong><p>${graph.nodes.length} nodes / ${graph.edges.length} edges / generated ${escapeHtml(graph.generated_at)}</p></div>${blocks.join("")}${pipelineBlock}${serviceBlock}${autonomousBlock}${actionLoopBlock}`;
  }
  if (btnWorld) {
    btnWorld.addEventListener("click", () => {
      Object.values(viewButtons).forEach((btn) => btn.classList.remove("active"));
      btnWorld.classList.add("active");
      renderWorldView();
    });
  }

  // ---- Collapsible side panel (Owner Phase 2 item 5) ----
  const panelToggleEl = document.getElementById("panel-toggle");
  panelToggleEl.addEventListener("click", () => {
    const collapsed = sidePanelEl.classList.toggle("collapsed");
    panelToggleEl.textContent = collapsed ? "‹" : "›";
  });

  // ---- Layer filtering (Owner Phase 2 item 2) — a pure opacity FILTER over the SAME real
  // component/connection set already loaded; never adds/removes a node, never a second
  // topology. Real component_type groups only (STORAGE/PERMISSION/EXECUTION/API+EXTERNAL_SERVICE);
  // BUSINESS/COST_TIME/HISTORY checkboxes are disabled — Owner, 2026-08-19: "ให้แสดงว่า
  // unavailable/UNKNOWN ห้ามสร้างข้อมูลเติม".
  const LAYER_TYPE_GROUPS = {
    PERMISSION: ["PERMISSION"],
    EXECUTION: ["EXECUTION", "RUNTIME"],
    STORAGE: ["STORAGE"],
    API: ["API", "EXTERNAL_SERVICE"],
  };
  const layerState = { PERMISSION: true, EXECUTION: true, STORAGE: true, API: true, EVIDENCE: true };

  // ---- Semantic LOD (Owner Phase 2 item 1) — real cytoscape zoom event drives a real,
  // deterministic tier band; only opacity changes (never position, never topology). Bands are
  // relative to the real fitted overview zoom captured above (initialViewport.zoom), so "zoom
  // in from the overview" is what reveals deeper tiers, matching Owner's literal ordering.
  const lodIndicatorEl = document.getElementById("lod-indicator");
  function currentVisibleTierCount() {
    const ratio = cy.zoom() / initialViewport.zoom;
    if (ratio < 1.15) return 2; // DOMAIN_SYSTEM, CAPABILITY
    if (ratio < 1.8) return 3; // + COMPONENT_PROCESS
    if (ratio < 2.8) return 4; // + FUNCTION_PORT_CONNECTION_API_STORAGE
    return 5; // + CONTRACT_RUNTIME_EVIDENCE_SOURCE
  }

  /**
   * The one real place BOTH filters (layers, item 2) and (LOD, item 1) combine into a single
   * opacity per element — computed fresh every call from the same two real sources
   * (layerState + componentById/connectionById's real lod_tier), never accumulated/compounded
   * across calls. Applying either filter alone therefore always resets the other correctly.
   */
  function applyVisualFilters() {
    const visibleTierCount = currentVisibleTierCount();
    cy.nodes().forEach((n) => {
      const sem = componentById.get(n.id());
      if (!sem) return; // no semantic record (ports, domain headers) — untouched, keeps its own existing behavior
      let layerVisible = true;
      for (const [layerKey, types] of Object.entries(LAYER_TYPE_GROUPS)) {
        if (types.includes(sem.component_type) && !layerState[layerKey]) layerVisible = false;
      }
      const lodVisible = LOD_TIER_ORDER.indexOf(sem.lod_tier) < visibleTierCount;
      n.style("opacity", !layerVisible ? 0.08 : lodVisible ? 1 : 0.15);
    });
    cy.edges().forEach((e) => {
      const sem = connectionById.get(e.id());
      if (!sem) return;
      const lodVisible = LOD_TIER_ORDER.indexOf(sem.lod_tier) < visibleTierCount;
      e.style("opacity", lodVisible ? 1 : 0.1);
    });
    lodIndicatorEl.textContent = `LOD: ${LOD_TIER_LABEL[LOD_TIER_ORDER[visibleTierCount - 1]]} (zoom ${cy.zoom().toFixed(2)})`;
  }

  ["PERMISSION", "EXECUTION", "STORAGE", "API", "EVIDENCE"].forEach((key) => {
    document.getElementById(`layer-${key}`).addEventListener("change", (evt) => {
      layerState[key] = evt.target.checked;
      applyVisualFilters();
    });
  });

  cy.on("zoom", applyVisualFilters);
  applyVisualFilters();

  // ---- "Marching ants" animation, ONLY for edges a real SSE event just marked ACTIVE ----
  // No timer here ever adds/removes the ACTIVE class itself — that only ever happens inside
  // applyEdgeUpdate, driven exclusively by a real snapshot/change event over /events. This
  // loop only nudges line-dash-offset on whatever the real state already is; with zero ACTIVE
  // edges (the common case) it does no style writes at all, so there is no decorative motion
  // ever running without a real runtime event behind it.
  let dashTick = 0;
  setInterval(() => {
    const activeEdges = cy.edges(".state-ACTIVE");
    if (activeEdges.length === 0) return;
    dashTick = (dashTick + 2) % 24;
    activeEdges.style("line-dash-offset", -dashTick);
  }, 80);

  const source = new EventSource("/events");
  source.onopen = () => {
    statusEl.textContent = "live — connected";
  };
  source.onerror = () => {
    statusEl.textContent = "disconnected — retrying…";
  };
  source.onmessage = (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      if (payload.type === "snapshot") {
        applySnapshot(payload.snapshot);
        statusEl.textContent = `live — updated ${new Date(payload.snapshot.updated_at).toLocaleTimeString()}`;
      } else if (payload.type === "change") {
        applySnapshot(payload.snapshot);
        statusEl.textContent = `live — ${payload.event.kind} ${payload.event.id} → ${payload.event.status || payload.event.state} (${new Date(payload.snapshot.updated_at).toLocaleTimeString()})`;
      }
    } catch (err) {
      // A malformed event must never blank the whole canvas silently — log and keep the last good render.
      console.error("dna-os-circuit: failed to apply SSE event", err);
    }
  };
}

boot().catch((err) => {
  document.getElementById("status").textContent = "failed to load circuit: " + err;
  console.error(err);
});

// ---- Phase 20 — the one Owner-facing entry. No model/Lab/worker/repo/scanner/tool is
// ever selected here; the Owner only states a problem. Reuses the SAME page/side panel. ----
(function wireProblemBar() {
  const input = document.getElementById("problem-input");
  const btn = document.getElementById("btn-problem-submit");
  const statusEl = document.getElementById("problem-status");
  if (!input || !btn) return;

  async function submitProblem() {
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    statusEl.textContent = "กำลังตรวจ";
    try {
      statusEl.textContent = "กำลังจัดเส้นทาง";
      const res = await fetch("/resolve-problem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problem_text: text }) });
      statusEl.textContent = "กำลังทำ";
      const data = await res.json();
      statusEl.textContent = "กำลังตรวจผล";
      if (data.error) {
        statusEl.textContent = "ยังไม่สำเร็จ";
        renderProblemResult({ result: "ยังไม่สำเร็จ", evidence: { what_changed: "none", what_verified_it: "request failed", what_remains_unresolved: data.error } });
        return;
      }
      statusEl.textContent = data.result || "ยังไม่สำเร็จ";
      renderProblemResult(data);
    } catch (err) {
      statusEl.textContent = "ยังไม่สำเร็จ";
      renderProblemResult({ result: "ยังไม่สำเร็จ", evidence: { what_changed: "none", what_verified_it: "request failed", what_remains_unresolved: String(err) } });
    } finally {
      btn.disabled = false;
    }
  }

  function renderProblemResult(data) {
    const sidePanelEl = document.getElementById("side-panel");
    const panelToggleEl = document.getElementById("panel-toggle");
    sidePanelEl.classList.remove("collapsed");
    if (panelToggleEl) panelToggleEl.textContent = "›";
    const ev = data.evidence || {};
    sidePanelEl.innerHTML = `<div class="panel-section">
      <strong>ผลลัพธ์: ${data.result === "สำเร็จ" ? "✅ สำเร็จ" : "⚠️ ยังไม่สำเร็จ"}</strong>
      <p class="field-label">หลักฐาน — สิ่งที่เปลี่ยน</p><p class="field-value">${escapeHtml(String(ev.what_changed || "-"))}</p>
      <p class="field-label">หลักฐาน — สิ่งที่ยืนยันผล</p><p class="field-value">${escapeHtml(String(ev.what_verified_it || "-"))}</p>
      <p class="field-label">สิ่งที่ยังไม่คลี่คลาย</p><p class="field-value">${escapeHtml(String(ev.what_remains_unresolved || "-"))}</p>
      ${data.resolution ? `<p class="field-label">เส้นทางที่ระบบเลือก (ไม่ใช่ Owner เลือก)</p><p class="field-value mono">${escapeHtml(data.resolution.relevant_existing_capability || "")}</p>` : ""}
    </div>`;
  }

  btn.addEventListener("click", submitProblem);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submitProblem(); });
})();

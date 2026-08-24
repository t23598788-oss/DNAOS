// Plain client JS (no build step, no framework) — loaded by index.html.
//
// Evidence Trace Viewer (2026-08-19, Owner-requested): a "fact-checking"
// surface, NOT a dashboard. It reads three of Circuit's own real,
// already-built endpoints —
//   GET /findings                      (dna-os-circuit/runtime/finding-receiver.ts)
//   GET /findings/evaluation-evidence  (dna-os-circuit/runtime/finding-evaluator.ts)
//   GET /findings/decision-evidence    (dna-os-circuit/runtime/finding-decider.ts)
// — and renders the real DETECTED -> EVALUATED -> DECISION -> current-status
// chain for one finding at a time.
//
// HARD RULE (Owner's own words): "ห้ามสร้างข้อเท็จจริงเอง และห้ามให้ AI
// แต่งคำอธิบายมาแทนหลักฐาน" — this file never invents a value. Every string
// rendered in #detail-panel is either (a) a literal field pulled straight
// from one of the three fetch responses, labeled with its own real field
// name, or (b) a FIXED, code-reviewed legend of what a status/decision
// enum value structurally means in this system (documentation of the
// contract, never a per-finding guess) — never a per-instance narrative
// generated for this specific finding. Cross-references (e.g. does
// based_on_evaluation_evidence_id really resolve to a real evaluation
// entry) are computed by literal string comparison against the fetched
// data, never assumed.

const ENDPOINTS = {
  findings: "/findings",
  evaluationEvidence: "/findings/evaluation-evidence",
  decisionEvidence: "/findings/decision-evidence",
};

// Fixed, code-reviewed glosses of the real enum values — contract documentation,
// never a fact about any specific finding. See contracts/worker/finding-event.ts
// for the authoritative definitions these are transcribed from.
const STATUS_GLOSS = {
  DETECTED: "reported by a real File Intelligence scan; not yet evaluated",
  EVALUATED: "a real rule assigned classification; not yet decided",
  TRIAGED: "forwarded for human review (classification was UNKNOWN/unclassified)",
  ROUTABLE: "decided NEEDS_FIX or ACCEPT — ready to route (WorkRequest conversion NOT_BUILT)",
  BLOCKED: "decided FORBIDDEN — a security-sensitive warning_type, not auto-processed",
  RESOLVED: "decided REJECT — classified TEST_FIXTURE, no action needed",
};
const STATUS_COLORS = { DETECTED: "#d29922", EVALUATED: "#58a6ff", TRIAGED: "#a371f7", ROUTABLE: "#3fb950", BLOCKED: "#f85149", RESOLVED: "#6e7681" };
const DECISION_GLOSS = {
  ACCEPT: "accepted as-is (not reachable by today's real rules — see finding-decider.ts)",
  REJECT: "rejected — classification was TEST_FIXTURE, no real issue",
  NEEDS_FIX: "real issue, no security-sensitive warning_type — ready to route",
  FORWARD: "classification was UNKNOWN/unclassified — sent for human review",
  FORBIDDEN: "real issue with a security-sensitive warning_type — processing forbidden",
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function fieldRow(key, value, mono) {
  return `<div class="field-row"><div class="k">${escapeHtml(key)}</div><div class="v${mono ? " mono" : ""}">${escapeHtml(value)}</div></div>`;
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

let state = {
  findings: [], // ReceivedFinding[]
  evaluationEvidence: [], // EvaluationVerdict[]
  decisionEvidence: [], // FindingDecisionRecord[]
  selectedFindingId: null,
  activeNode: null, // "detected" | "evaluated" | "decision" | "status"
};

function evaluationsFor(findingId) {
  return state.evaluationEvidence.filter((e) => e.finding_id === findingId);
}
function decisionsFor(findingId) {
  return state.decisionEvidence.filter((d) => d.finding_id === findingId);
}
function latestEvaluationEvidenceId(findingId) {
  const list = evaluationsFor(findingId);
  return list.length > 0 ? list[list.length - 1].evaluation_evidence_id : null;
}

async function loadAll() {
  const statusEl = document.getElementById("status");
  statusEl.textContent = "loading…";
  try {
    const [findingsRes, evalRes, decRes] = await Promise.all([
      fetchJson(ENDPOINTS.findings),
      fetchJson(ENDPOINTS.evaluationEvidence),
      fetchJson(ENDPOINTS.decisionEvidence),
    ]);
    state.findings = findingsRes.findings;
    state.evaluationEvidence = evalRes.evaluation_evidence;
    state.decisionEvidence = decRes.decision_evidence;
    statusEl.textContent = `live — ${state.findings.length} finding(s), ${state.evaluationEvidence.length} evaluation(s), ${state.decisionEvidence.length} decision(s)`;
    renderFindingList();
    if (state.selectedFindingId) {
      selectFinding(state.selectedFindingId); // re-render current selection with fresh data
    }
  } catch (err) {
    statusEl.textContent = "OFFLINE — could not reach Circuit's real endpoints";
    console.error("evidence-trace: fetch failed", err);
  }
}

function renderFindingList() {
  const listEl = document.getElementById("finding-list");
  listEl.innerHTML = '<div class="list-header">Findings</div>';
  // Most recently received first — a real, stable ordering already implied by receiver_evidence ordering.
  const rows = [...state.findings].reverse();
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "finding-row" + (r.finding.finding_id === state.selectedFindingId ? " selected" : "");
    const color = STATUS_COLORS[r.finding.status] || "#8fa3b3";
    row.innerHTML = `
      <div class="fid">${escapeHtml(r.finding.finding_id)}</div>
      <div class="wtype">${escapeHtml(r.finding.warning_type)}</div>
      <div class="status-pill" style="background:${color}22;color:${color};border:1px solid ${color}55;">${escapeHtml(r.finding.status)}</div>
    `;
    row.addEventListener("click", () => selectFinding(r.finding.finding_id));
    listEl.appendChild(row);
  }
}

function selectFinding(findingId) {
  state.selectedFindingId = findingId;
  state.activeNode = null;
  renderFindingList();
  renderTraceChain();
  renderDetail(null);
}

function renderTraceChain() {
  const col = document.getElementById("trace-column");
  const received = state.findings.find((r) => r.finding.finding_id === state.selectedFindingId);
  if (!received) {
    col.innerHTML = '<div class="placeholder">Finding not found in the current fetch.</div>';
    return;
  }
  const evaluations = evaluationsFor(state.selectedFindingId);
  const decisions = decisionsFor(state.selectedFindingId);
  const hasEvaluation = evaluations.length > 0;
  const hasDecision = decisions.length > 0;

  const nodeHtml = (key, label, value, hint, present) => `
    <div class="trace-node ${present ? "" : "missing"} ${state.activeNode === key ? "active" : ""}" data-node="${key}">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
      ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ""}
    </div>`;

  col.innerHTML = [
    nodeHtml("detected", "1 · DETECTED", received.finding.warning_type, `finding_id: ${received.finding.finding_id}`, true),
    '<div class="trace-arrow">↓</div>',
    nodeHtml(
      "evaluated",
      "2 · EVALUATED",
      hasEvaluation ? evaluations[evaluations.length - 1].classification : "not yet evaluated",
      hasEvaluation ? `rule: ${evaluations[evaluations.length - 1].rule_fired}` : "no evaluation-evidence entry exists for this finding_id",
      hasEvaluation
    ),
    '<div class="trace-arrow">↓</div>',
    nodeHtml(
      "decision",
      "3 · DECISION",
      hasDecision ? decisions[decisions.length - 1].decision : "not yet decided",
      hasDecision ? `rule: ${decisions[decisions.length - 1].rule_fired}` : "no decision-evidence entry exists for this finding_id",
      hasDecision
    ),
    '<div class="trace-arrow">↓</div>',
    nodeHtml("status", "4 · CURRENT STATUS", received.finding.status, STATUS_GLOSS[received.finding.status] || "", true),
  ].join("");

  col.querySelectorAll(".trace-node:not(.missing)").forEach((el) => {
    el.addEventListener("click", () => {
      state.activeNode = el.getAttribute("data-node");
      renderTraceChain();
      renderDetail(state.activeNode);
    });
  });
}

function renderDetail(node) {
  const panel = document.getElementById("detail-panel");
  const received = state.findings.find((r) => r.finding.finding_id === state.selectedFindingId);
  if (!received || !node) {
    panel.innerHTML = '<div class="placeholder">Click a node in the chain to see the exact real evidence behind it — every value shown is a literal field from Circuit\'s stored data, never a generated summary.</div>';
    return;
  }
  const f = received.finding;

  if (node === "detected") {
    const evidenceItems = f.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
    const filesItems = f.files_involved.map((p) => `<li class="mono">${escapeHtml(p)}</li>`).join("");
    panel.innerHTML = `
      <h2>DETECTED</h2>
      <div class="detail-sub">from DNA-LAB-FILE-INTELLIGENCE's real Warning record — every field below is exactly what the scanner reported, unmodified</div>
      ${fieldRow("finding_id", f.finding_id, true)}
      ${fieldRow("scan_id", f.scan_id, true)}
      ${fieldRow("source_system", f.source_system)}
      ${fieldRow("warning_type", f.warning_type)}
      ${fieldRow("owner_folder", f.owner_folder, true)}
      ${fieldRow("detected_at", f.detected_at)}
      ${fieldRow("received_at (by Circuit)", received.received_at)}
      ${fieldRow("receiver_evidence_id", received.receiver_evidence_id, true)}
      ${fieldRow("capability_id", f.capability_id === null ? "null (File Intelligence has no Circuit knowledge)" : f.capability_id)}
      ${fieldRow("severity", f.severity === null ? "null (real Warning type has no severity field)" : f.severity)}
      <div class="section-title">files_involved (real, from the owning FileRecord)</div>
      <ul class="evidence-list">${filesItems || "<li>(none)</li>"}</ul>
      <div class="section-title">evidence (real, verbatim from Warning.evidence)</div>
      <ul class="evidence-list">${evidenceItems || "<li>(none)</li>"}</ul>
    `;
    return;
  }

  if (node === "evaluated") {
    const list = evaluationsFor(f.finding_id);
    if (list.length === 0) {
      panel.innerHTML = '<h2>EVALUATED</h2><div class="not-found-banner">No evaluation-evidence entry exists for this finding_id in GET /findings/evaluation-evidence. This finding has not been evaluated.</div>';
      return;
    }
    const v = list[list.length - 1];
    panel.innerHTML = `
      <h2>EVALUATED</h2>
      <div class="detail-sub">from dna-os-circuit/runtime/finding-evaluator.ts's real deterministic rule — a real rule name, never an AI judgment</div>
      ${fieldRow("finding_id", v.finding_id, true)}
      ${fieldRow("scan_id", v.scan_id, true)}
      ${fieldRow("classification", v.classification)}
      ${fieldRow("rule_fired", v.rule_fired, true)}
      ${fieldRow("matched_evidence", v.matched_evidence, true)}
      ${fieldRow("evaluated_at", v.evaluated_at)}
      ${fieldRow("evaluation_evidence_id", v.evaluation_evidence_id, true)}
      <div class="section-title">trace back</div>
      <div class="link-check ok" id="link-to-detected">↑ view the DETECTED evidence this rule ran against</div>
    `;
    document.getElementById("link-to-detected").addEventListener("click", () => {
      state.activeNode = "detected";
      renderTraceChain();
      renderDetail("detected");
    });
    return;
  }

  if (node === "decision") {
    const list = decisionsFor(f.finding_id);
    if (list.length === 0) {
      panel.innerHTML = '<h2>DECISION</h2><div class="not-found-banner">No decision-evidence entry exists for this finding_id in GET /findings/decision-evidence. This finding has not been decided.</div>';
      return;
    }
    const d = list[list.length - 1];
    // Real, literal cross-check — never assumed: does based_on_evaluation_evidence_id actually
    // resolve to a real entry in the evaluation-evidence log?
    const linked = state.evaluationEvidence.find((e) => e.evaluation_evidence_id === d.based_on_evaluation_evidence_id);
    const linkHtml =
      d.based_on_evaluation_evidence_id === null
        ? '<div class="link-check fail">✗ based_on_evaluation_evidence_id is null — no evaluation was linked</div>'
        : linked
        ? `<div class="link-check ok" id="link-to-eval">✓ verified — matches a real entry: ${escapeHtml(d.based_on_evaluation_evidence_id)} (click to view)</div>`
        : `<div class="link-check fail">✗ based_on_evaluation_evidence_id "${escapeHtml(d.based_on_evaluation_evidence_id)}" was NOT FOUND in the evaluation-evidence log</div>`;
    panel.innerHTML = `
      <h2>DECISION: ${escapeHtml(d.decision)}</h2>
      <div class="detail-sub">${escapeHtml(DECISION_GLOSS[d.decision] || "")}</div>
      ${fieldRow("finding_id", d.finding_id, true)}
      ${fieldRow("decision", d.decision)}
      ${fieldRow("rule_fired", d.rule_fired, true)}
      ${fieldRow("matched_evidence", d.matched_evidence, true)}
      ${fieldRow("new_status", d.new_status)}
      ${fieldRow("decided_at", d.decided_at)}
      ${fieldRow("decision_evidence_id", d.decision_evidence_id, true)}
      <div class="section-title">trace back to the evaluation this decision was based on</div>
      ${linkHtml}
    `;
    const linkEl = document.getElementById("link-to-eval");
    if (linkEl) {
      linkEl.addEventListener("click", () => {
        state.activeNode = "evaluated";
        renderTraceChain();
        renderDetail("evaluated");
      });
    }
    return;
  }

  if (node === "status") {
    const decisions = decisionsFor(f.finding_id);
    const settingDecision = decisions.find((d) => d.new_status === f.status);
    panel.innerHTML = `
      <h2>CURRENT STATUS: ${escapeHtml(f.status)}</h2>
      <div class="detail-sub">${escapeHtml(STATUS_GLOSS[f.status] || "")}</div>
      ${fieldRow("finding_id", f.finding_id, true)}
      ${fieldRow("status (live, from GET /findings)", f.status)}
      ${
        settingDecision
          ? fieldRow("set by decision_evidence_id", settingDecision.decision_evidence_id, true)
          : '<div class="not-found-banner">No decision-evidence entry\'s new_status matches this finding\'s current status — status may not have been set by a decision (e.g. still DETECTED/EVALUATED).</div>'
      }
    `;
    return;
  }
}

document.getElementById("refresh-btn").addEventListener("click", loadAll);
loadAll();

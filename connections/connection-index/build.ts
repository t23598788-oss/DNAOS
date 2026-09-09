/**
 * Documentation-only projection builder.
 *
 * The per-connection `connection-document.json` files remain authoritative.
 * This file reads those semantic records plus the existing connection
 * declaration JSONL and writes the Owner-facing index projections. It does
 * not register, execute, probe, or alter any runtime connection.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const INDEX_DIR = join(ROOT, "connections", "connection-index");
const MACHINE_OUT = join(INDEX_DIR, "index.json");
const HUMAN_OUT = join(INDEX_DIR, "INDEX.md");
const DECLARATIONS = join(ROOT, "connections", "connection-registry", "data", "connection-declarations.jsonl");
const STATUS_VOCABULARY = ["VERIFIED", "CONNECTED", "NOT_VERIFIED", "BLOCKED", "NOT_WIRED"] as const;

type Status = typeof STATUS_VOCABULARY[number];
type Json = Record<string, unknown>;

function rel(path: string): string { return relative(ROOT, path).replaceAll("\\", "/"); }
function readJson(path: string): Json { return JSON.parse(readFileSync(path, "utf8")) as Json; }
function titleOf(value: unknown): string { return typeof value === "string" && value.length > 0 ? value : "Undocumented connection"; }
function targetLabel(target: unknown): string { return typeof target === "object" && target !== null ? JSON.stringify(target) : String(target ?? "unknown"); }

function findConnectionDocuments(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "connection-index" || entry.name === "connection-registry") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findConnectionDocuments(path));
    else if (entry.name === "connection-document.json") found.push(path);
  }
  return found.sort();
}

function statusForDeclaration(declaration: Json): Status {
  if (declaration.state === "CONFIGURATION_DRIFT") return "BLOCKED";
  return "NOT_VERIFIED";
}

function boundaryById(doc: Json, id: string): Json | undefined {
  const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries as Json[] : [];
  return boundaries.find((boundary) => boundary.id === id);
}

function authoritativeEntry(path: string): Json {
  const doc = readJson(path);
  if (doc.document_id === "connection.ai-model.dna-os-mcp.v1") {
    const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries as Json[] : [];
    const first = boundaries[0] ?? {};
    const last = boundaries[boundaries.length - 1] ?? {};
    const projections = doc.projections as Json | undefined;
    const security = doc.security as Json | undefined;
    const roles = doc.role_separation as Json | undefined;
    return {
      connection_id: doc.document_id,
      name: doc.title,
      source_system: "External OpenAI / AI Model requester",
      destination_system: "DNA OS MCP host and Owner authority/execution system",
      connection_type: "MODEL_REQUESTER_TOOL_INGRESS",
      status: doc.status,
      verification_level: doc.verification_level,
      document_path: rel(path),
      machine_record_path: rel(path),
      human_document_path: typeof projections?.human_view === "string" ? projections.human_view : null,
      entry_boundary: { source: first.source, destination: first.destination, contract: first.contract_function },
      exit_boundary: { source: last.source, destination: last.destination, contract: last.contract_function },
      authentication: security?.references ?? [],
      authority: [roles?.model, roles?.dna_os, roles?.direct_model_authority],
      capabilities: ["MCP submit_command", "Owner command request", "read-only result/task/evidence observation"],
      live_evidence: doc.live_verification ?? {},
      last_verified_at: doc.recorded_at,
      known_gaps: doc.overall_gaps ?? [],
      next_required_connection: doc.next_required_connection,
      dependencies: doc.dependencies ?? [],
      owner_visible_summary: "The generic external-model → MCP → DNA OS requester path is CONNECTED and reaches a VERIFIED Owner/worker/result path. The model remains requester/reasoner only. Direct OpenAI provider API wiring is NOT_WIRED / NOT_VERIFIED; execution.run is also NOT_WIRED / NOT_VERIFIED.",
      boundary_statuses: doc.boundary_statuses ?? {},
      source_document_status: "AUTHORITATIVE",
      projected_boundary_count: boundaries.length,
      declaration_ids: [],
    };
  }
  if (doc.document_id === "connection.n8n.dna-os-workflow-control.v1") {
    const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries as Json[] : [];
    const first = boundaries[0] ?? {};
    const last = boundaries[boundaries.length - 1] ?? {};
    const projections = doc.projections as Json | undefined;
    const identity = doc.instance_identity as Json | undefined;
    const security = doc.security as Json | undefined;
    const authority = doc.authority as Json | undefined;
    return {
      connection_id: doc.document_id,
      name: doc.title,
      source_system: "DNA OS central event router",
      destination_system: "n8n workflow-control instance and router workflow",
      connection_type: "WORKFLOW_CONTROL",
      status: doc.status,
      verification_level: doc.verification_level,
      document_path: rel(path),
      machine_record_path: rel(path),
      human_document_path: typeof projections?.human_view === "string" ? projections.human_view : null,
      entry_boundary: { source: first.source, destination: first.destination, contract: first.contract_function },
      exit_boundary: { source: last.source, destination: last.destination, contract: last.contract_function },
      authentication: security?.references ?? [],
      authority: authority ? Object.values(authority) : [],
      capabilities: ["central event classification", "loop guard", "route_group decision", "DNA OS owner resolution handoff", "routing evidence"],
      live_evidence: doc.live_verification ?? {},
      last_verified_at: doc.last_verified_at ?? doc.recorded_at,
      known_gaps: doc.overall_gaps ?? [],
      next_required_connection: doc.next_required_connection,
      dependencies: doc.dependencies ?? [],
      owner_visible_summary: `n8n has historical live workflow proof, but the current declared target ${String(identity?.declared_endpoint ?? "unknown")} is in CONFIGURATION_DRIFT and BLOCKED. The observed local runtime is not wired to DNA OS; inbound callbacks are NOT_WIRED.`,
      boundary_statuses: doc.boundary_statuses ?? {},
      source_document_status: "AUTHORITATIVE",
      projected_boundary_count: boundaries.length,
      declaration_ids: [],
    };
  }
  if (doc.document_id === "connection.github.dna-os-source-authority.v1") {
    const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries as Json[] : [];
    const first = boundaries[0] ?? {};
    const last = boundaries[boundaries.length - 1] ?? {};
    const projections = doc.projections as Json | undefined;
    const identity = doc.repository_identity as Json | undefined;
    const security = doc.security as Json | undefined;
    const authority = doc.authority as Json | undefined;
    return {
      connection_id: doc.document_id,
      name: doc.title,
      source_system: "DNA OS Owner command and Engineering GitHub Publish Authority",
      destination_system: "GitHub source-authority repository and REST API",
      connection_type: "SOURCE_AUTHORITY",
      status: doc.status,
      verification_level: doc.verification_level,
      document_path: rel(path),
      machine_record_path: rel(path),
      human_document_path: typeof projections?.human_view === "string" ? projections.human_view : null,
      entry_boundary: { source: first.source, destination: first.destination, contract: first.contract_function },
      exit_boundary: { source: last.source, destination: last.destination, contract: last.contract_function },
      authentication: security?.references ?? [],
      authority: authority ? Object.values(authority) : [],
      capabilities: ["connector.github.check_access", "connector.github.read_status", "DNA OS GitHub Publish Authority", "push webhook verification"],
      live_evidence: doc.live_verification ?? {},
      last_verified_at: doc.recorded_at,
      known_gaps: doc.overall_gaps ?? [],
      next_required_connection: doc.next_required_connection,
      dependencies: doc.dependencies ?? [],
      owner_visible_summary: `GitHub read routing and credential wiring are verified; declared repository ${String(identity?.declared_owner ?? "unknown")}/${String(identity?.declared_repository ?? "unknown")} Contents write is closed. Source publication is DNA OS GitHub Publish Authority only; live publish is VERIFIED (DNA OS commit SHA equals remote SHA). Pull Request and production deploy are NOT_WIRED.`,
      boundary_statuses: doc.boundary_statuses ?? {},
      source_document_status: "AUTHORITATIVE",
      projected_boundary_count: boundaries.length,
      declaration_ids: [],
    };
  }
  if (doc.document_id === "connection.digitalocean.dna-os-provider.v1") {
    const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries as Json[] : [];
    const first = boundaries[0] ?? {};
    const last = boundaries[boundaries.length - 1] ?? {};
    const projections = doc.projections as Json | undefined;
    const provider = doc.provider_identity as Json | undefined;
    const security = doc.security as Json | undefined;
    const authority = doc.authority as Json | undefined;
    return {
      connection_id: doc.document_id,
      name: doc.title,
      source_system: "DNA OS Owner command and provider connector",
      destination_system: "DigitalOcean API and provider resources",
      connection_type: "INFRASTRUCTURE_PROVIDER",
      status: doc.status,
      verification_level: doc.verification_level,
      document_path: rel(path),
      machine_record_path: rel(path),
      human_document_path: typeof projections?.human_view === "string" ? projections.human_view : null,
      entry_boundary: { source: first.source, destination: first.destination, contract: first.contract_function },
      exit_boundary: { source: last.source, destination: last.destination, contract: last.contract_function },
      authentication: security?.references ?? [],
      authority: authority ? Object.values(authority) : [],
      capabilities: Array.isArray(provider?.implemented_dna_os_capabilities) ? provider.implemented_dna_os_capabilities : [],
      live_evidence: doc.live_verification ?? {},
      last_verified_at: doc.recorded_at,
      known_gaps: doc.overall_gaps ?? [],
      next_required_connection: doc.next_required_connection,
      dependencies: doc.dependencies ?? [],
      owner_visible_summary: "DigitalOcean command routing and the read-only connector are wired and evidence-backed, but the production account-binding registry and Vault credential broker are NOT_WIRED. Authenticated DigitalOcean API access is BLOCKED; deployment/hosting is NOT_WIRED.",
      boundary_statuses: doc.boundary_statuses ?? {},
      source_document_status: "AUTHORITATIVE",
      projected_boundary_count: boundaries.length,
      declaration_ids: [],
    };
  }
  if (doc.document_id === "connection.supabase.dna-os-project.v1") {
    const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries as Json[] : [];
    const first = boundaries[0] ?? {};
    const last = boundaries[boundaries.length - 1] ?? {};
    const projections = doc.projections as Json | undefined;
    const project = doc.project_identity as Json | undefined;
    const security = doc.security as Json | undefined;
    const authority = doc.authority as Json | undefined;
    return {
      connection_id: doc.document_id,
      name: doc.title,
      source_system: "DNA OS callers and local control-plane processes",
      destination_system: `Supabase project ${String(project?.project_ref ?? "unknown")}`,
      connection_type: "INFRASTRUCTURE_PROVIDER",
      status: doc.status,
      verification_level: doc.verification_level,
      document_path: rel(path),
      machine_record_path: rel(path),
      human_document_path: typeof projections?.human_view === "string" ? projections.human_view : null,
      entry_boundary: { source: first.source, destination: first.destination, contract: first.contract_function },
      exit_boundary: { source: last.source, destination: last.destination, contract: last.contract_function },
      authentication: security?.references ?? [],
      authority: authority ? Object.values(authority) : [],
      capabilities: boundaries.map((boundary) => boundary.contract_function).filter((value): value is string => typeof value === "string"),
      live_evidence: doc.live_verification ?? {},
      last_verified_at: doc.recorded_at,
      known_gaps: doc.overall_gaps ?? [],
      next_required_connection: doc.next_required_connection,
      dependencies: doc.dependencies ?? [],
      owner_visible_summary: "Supabase is CONNECTED as the resolved DNA OS provider project. The provider-alert Edge Function boundary is VERIFIED; PostgREST/Auth/secret provisioning/sensor sink remain NOT_VERIFIED, and the software_registry production database target is NOT_WIRED.",
      boundary_statuses: doc.boundary_statuses ?? {},
      source_document_status: "AUTHORITATIVE",
      projected_boundary_count: boundaries.length,
      declaration_ids: [],
    };
  }
  if (doc.document_id === "connection.railway.dna-os-provider.v1") {
    const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries as Json[] : [];
    const first = boundaries[0] ?? {};
    const last = boundaries[boundaries.length - 1] ?? {};
    const projections = doc.projections as Json | undefined;
    const provider = doc.provider_identity as Json | undefined;
    const security = doc.security as Json | undefined;
    return {
      connection_id: doc.document_id,
      name: doc.title,
      source_system: "DNA OS provider/project registry and connector boundary",
      destination_system: "Railway project, GraphQL API, hosted services, and recorded runtime resources",
      connection_type: "DEPLOYMENT_PLATFORM",
      status: doc.status,
      verification_level: doc.verification_level,
      document_path: rel(path),
      machine_record_path: rel(path),
      human_document_path: typeof projections?.human_view === "string" ? projections.human_view : null,
      entry_boundary: { source: first.source, destination: first.destination, contract: first.contract_function },
      exit_boundary: { source: last.source, destination: last.destination, contract: last.contract_function },
      authentication: security?.references ?? [],
      authority: ["Read-only Railway environment-status authority only", "No deployment/write/mutation authority is wired"],
      capabilities: ["railway.environment_status", "Railway runtime/deployment evidence projection", "registered Railway CLI read records"],
      live_evidence: doc.live_verification ?? {},
      last_verified_at: doc.last_verified_at ?? doc.recorded_at,
      known_gaps: doc.overall_gaps ?? [],
      next_required_connection: doc.next_required_connection,
      dependencies: doc.dependencies ?? [],
      owner_visible_summary: "Railway project identity, the read-only environment-status invoker, credential resolution, Railway-hosted runtime evidence, and result/evidence return are VERIFIED. Owner command-router registration, Railway Postgres application wiring, CLI caller wiring, and deployment/write/mutation are NOT_WIRED or NOT_VERIFIED.",
      boundary_statuses: doc.boundary_statuses ?? {},
      source_document_status: "AUTHORITATIVE",
      projected_boundary_count: boundaries.length,
      declaration_ids: [],
      provider_identity: { provider_id: provider?.provider_id, project: provider?.project, environment_id: provider?.environment_id },
    };
  }
  if (doc.document_id === "connection.engineering-runtime.coding-gate.v1") {
    const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries as Json[] : [];
    const first = boundaries[0] ?? {};
    const last = boundaries[boundaries.length - 1] ?? {};
    const projections = doc.projections as Json | undefined;
    const security = doc.security as Json | undefined;
    const authority = doc.authority as Json | undefined;
    return {
      connection_id: doc.document_id,
      name: doc.title,
      source_system: "Owner coding intent",
      destination_system: "DNA OS Engineering Runtime isolated worktree and LOCAL coding worker",
      connection_type: "ENGINEERING_CODING_GATE",
      status: doc.status,
      verification_level: doc.verification_level,
      document_path: rel(path),
      machine_record_path: rel(path),
      human_document_path: typeof projections?.human_view === "string" ? projections.human_view : null,
      entry_boundary: { source: first.source, destination: first.destination, contract: first.contract_function },
      exit_boundary: { source: last.source, destination: last.destination, contract: last.contract_function },
      authentication: security?.references ?? [],
      authority: authority ? Object.values(authority) : [],
      capabilities: ["engineering-runtime.scoped_coding", "admission", "local integration", "DNA OS commit", "DNA OS GitHub publish"],
      live_evidence: doc.live_verification ?? {},
      last_verified_at: doc.recorded_at,
      known_gaps: doc.overall_gaps ?? [],
      next_required_connection: doc.next_required_connection,
      dependencies: doc.dependencies ?? [],
      owner_visible_summary: "Engineering Runtime is the coding and source-publication authority path. CODING, ADMISSION, LOCAL_INTEGRATION, DNA_OS_COMMIT, GITHUB_PUBLISH, OWNER_EVIDENCE_PIPELINE, and DISPLAY_QUEUE are live-verified. EXTERNAL_AI_SOURCE_WRITE is DENIED_BY_ARCHITECTURE. DEPLOYMENT remains NOT_WIRED.",
      boundary_statuses: doc.boundary_statuses ?? {},
      source_document_status: "AUTHORITATIVE",
      projected_boundary_count: boundaries.length,
      declaration_ids: [],
    };
  }
  const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries as Json[] : [];
  const execution = (doc.execution_run_boundary ?? {}) as Json;
  const b01 = boundaryById(doc, "b01") ?? {};
  const b13 = boundaryById(doc, "b13") ?? {};
  const auth = boundaryById(doc, "b04") ?? {};
  const worker = boundaryById(doc, "b10") ?? {};
  const registry = boundaryById(doc, "b08") ?? {};

  return {
    connection_id: doc.document_id,
    name: doc.title,
    source_system: "External Model / AI via DNA OS MCP host",
    destination_system: "DNA OS Owner command system",
    connection_type: "TOOL_INGRESS",
    status: doc.status,
    verification_level: "LIVE_END_TO_END",
    document_path: rel(path),
    machine_record_path: rel(path),
    human_document_path: "connections/dna-os-mcp/MCP_OWNER_COMMAND_CONNECTION.md",
    entry_boundary: { source: b01.source, destination: b01.destination, contract: b01.contract_function },
    exit_boundary: { source: b13.source, destination: b13.destination, contract: b13.contract_function },
    authentication: [auth.authentication, "Transport shared-secret reference is documented by name only; secret value is never indexed."],
    authority: [auth.authority_permission, "MCP export/invoke policy and Core Owner authentication gates remain authoritative."],
    capabilities: [
      "MCP submit_command",
      "Owner command submission",
      "Owner command routing",
      "Capability Registry resolution",
      "agent-host / LOCAL worker dispatch",
      "Result and evidence return",
    ],
    live_evidence: doc.live_verification,
    last_verified_at: doc.recorded_at,
    known_gaps: [execution.statement],
    next_required_connection: "Owner Command → execution.run (requires executionRequestBase and executionPolicyContext; currently NOT_WIRED / NOT_VERIFIED)",
    dependencies: [
      ...new Set(boundaries.flatMap((boundary) => Array.isArray(boundary.source_code_reference) ? boundary.source_code_reference as string[] : [])),
      "connections/dna-os-mcp/connection-document.json",
    ],
    owner_visible_summary: "MCP → Owner Command is live-verified end-to-end. Network authorization, Owner session binding, submitOwnerCommand, routing, Capability Registry, agent-host LOCAL worker, isolated worktree, and result/evidence return are VERIFIED. execution.run remains NOT_WIRED / NOT_VERIFIED.",
    boundary_statuses: {
      "MCP → Owner Command": "VERIFIED",
      "Network Authorization": "VERIFIED",
      "Owner Session Binding": "VERIFIED",
      submitOwnerCommand: "VERIFIED",
      Router: "VERIFIED",
      "Capability Registry": "VERIFIED",
      "agent-host / LOCAL worker": "VERIFIED",
      "Result/Evidence return": "VERIFIED",
      "execution.run from Owner Command": execution.status === "NOT_WIRED" ? "NOT_WIRED" : execution.verification_status,
    },
    source_document_status: "AUTHORITATIVE",
    projected_boundary_count: boundaries.length,
    registry_boundary_reference: registry.contract_function ?? null,
    worker_boundary_reference: worker.contract_function ?? null,
    declaration_ids: [],
  };
}

function missingEntry(declaration: Json): Json {
  const credential = declaration.credential_ref as Json | null | undefined;
  const provider = titleOf(declaration.provider_id);
  const verificationMethod = typeof declaration.verification_method === "string" ? declaration.verification_method : null;
  return {
    connection_id: declaration.connection_id,
    name: `${provider} connection declaration`,
    source_system: declaration.source_id,
    destination_system: `${provider} (${targetLabel(declaration.target_descriptor)})`,
    connection_type: declaration.connection_type,
    status: statusForDeclaration(declaration),
    verification_level: declaration.state === "CONFIGURATION_DRIFT" ? "DECLARATION_WITH_CONFIGURATION_DRIFT" : "DECLARATION_ONLY",
    document_path: null,
    machine_record_path: null,
    human_document_path: null,
    entry_boundary: { source: declaration.source_id, destination: provider, contract: declaration.execution_boundary ?? null },
    exit_boundary: { source: provider, destination: declaration.source_id, contract: null },
    authentication: credential ? [`credential reference present: ${String(credential.kind ?? "unspecified")} (value never indexed)`] : ["No credential reference declared"],
    authority: "No authoritative per-connection semantic document exists yet; do not infer runtime authority from this declaration.",
    capabilities: declaration.executor_capability_id ? [declaration.executor_capability_id] : [],
    live_evidence: [],
    last_verified_at: null,
    known_gaps: ["DOCUMENT_MISSING", ...(verificationMethod ? [verificationMethod] : [])],
    next_required_connection: "Create and live-verify an authoritative connection document for this declared connection.",
    dependencies: [declaration.execution_boundary, declaration.configuration_source].filter((value): value is string => typeof value === "string"),
    owner_visible_summary: declaration.state === "CONFIGURATION_DRIFT"
      ? `${provider} is declared but has configuration drift; it is BLOCKED and has no authoritative connection document.`
      : `${provider} is declared in the existing Connection Registry, but has no authoritative connection document and is NOT_VERIFIED.`,
    boundary_statuses: {},
    source_document_status: "DOCUMENT_MISSING",
  };
}

function build(): void {
  const docs = findConnectionDocuments(join(ROOT, "connections"));
  const authoritative = docs.map((path) => authoritativeEntry(path));
  const declarations = readFileSync(DECLARATIONS, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Json);
  const matchedDeclarations = new Set<Json>();
  for (const entry of authoritative) {
    const matches = declarations.filter((declaration) => {
      if (entry.connection_id === "connection.mcp.owner-command.v1") {
        if (declaration.provider_id !== "dna-os" || declaration.connection_type !== "TOOL_INGRESS") return false;
        const target = declaration.target_descriptor as Json | undefined;
        return target?.path === "/mcp" && target?.port === "8793";
      }
      if (entry.connection_id === "connection.ai-model.dna-os-mcp.v1") {
        return false;
      }
      if (entry.connection_id === "connection.supabase.dna-os-project.v1") {
        return declaration.provider_id === "supabase"
          && (declaration.target_descriptor as Json | undefined)?.project_ref === "xeytcavxejhyzxwevgto";
      }
      if (entry.connection_id === "connection.digitalocean.dna-os-provider.v1") {
        return declaration.provider_id === "digitalocean"
          && (declaration.target_descriptor as Json | undefined)?.api_host === "api.digitalocean.com";
      }
      if (entry.connection_id === "connection.github.dna-os-source-authority.v1") {
        const target = declaration.target_descriptor as Json | undefined;
        return declaration.provider_id === "github"
          && target?.owner === "t23598788-oss"
          && target?.repository === "-DNA-OS-INFRASTRUCTURE-";
      }
      if (entry.connection_id === "connection.n8n.dna-os-workflow-control.v1") {
        const target = declaration.target_descriptor as Json | undefined;
        return declaration.provider_id === "n8n"
          && target?.host === "n8n.srv1740014.hstgr.cloud";
      }
      if (entry.connection_id === "connection.railway.dna-os-provider.v1") {
        const target = declaration.target_descriptor as Json | undefined;
        return declaration.provider_id === "railway"
          && target?.project === "dna-os-infrastructure"
          && target?.environment_id === "4d28eafa-9735-4405-a585-55ea354bafab";
      }
      return false;
    });
    if (matches.length > 0) {
      matches.forEach((declaration) => matchedDeclarations.add(declaration));
      entry.declaration_ids = matches.map((declaration) => declaration.connection_id);
    }
  }
  const declared = declarations.filter((declaration) => !matchedDeclarations.has(declaration)).map((declaration) => missingEntry(declaration));
  const entries = [...authoritative, ...declared];

  const index = {
    document_type: "dna_os_connection_index",
    index_id: "connection-index.v1",
    title: "DNA OS Connection Index",
    version: 1,
    generated_at: "2026-09-07",
    source_of_truth: "Each authoritative per-connection connection-document.json record. This index is a projection, not a second runtime registry.",
    status_vocabulary: STATUS_VOCABULARY,
    projection_rules: {
      authoritative_document_status: "Project the document status and boundary statuses without reinterpretation.",
      declaration_without_document: "status=NOT_VERIFIED and source_document_status=DOCUMENT_MISSING.",
      configuration_drift_without_document: "status=BLOCKED and source_document_status=DOCUMENT_MISSING.",
      connected_without_live_evidence: "status=CONNECTED only when the authoritative document says CONNECTED; never infer it from source existence or reachability alone.",
      secrets: "Index reference names and resolution mechanisms only; never credential values.",
    },
    entries,
    missing_authoritative_documents: entries.filter((entry) => entry.source_document_status === "DOCUMENT_MISSING").map((entry) => ({ connection_id: entry.connection_id, name: entry.name, status: entry.status })),
    documentation_surface: {
      human_index: "connections/connection-index/INDEX.md",
      machine_index: "connections/connection-index/index.json",
      builder: "connections/connection-index/build.ts",
      open_rule: "Open an entry's human_document_path for the detailed human-readable connection document; open machine_record_path for automation.",
    },
  };

  writeFileSync(MACHINE_OUT, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  const lines = [
    "# DNA OS Connection Index",
    "",
    "This is a generated documentation projection. Per-connection `connection-document.json` records remain authoritative; this index is not a second runtime registry.",
    "",
    "Machine index: [index.json](./index.json) · Builder: [build.ts](./build.ts)",
    "",
    "## Connections",
    "",
    "| Connection | Status | Verification | Human document | Machine record | Evidence | Known gaps |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const entry of entries) {
    const human = entry.human_document_path ? `[open](${relative(INDEX_DIR, join(ROOT, String(entry.human_document_path))).replaceAll("\\", "/")})` : "DOCUMENT_MISSING";
    const machine = entry.machine_record_path ? `[open](${relative(INDEX_DIR, join(ROOT, String(entry.machine_record_path))).replaceAll("\\", "/")})` : "DOCUMENT_MISSING";
    const evidence = entry.source_document_status === "AUTHORITATIVE" && entry.live_evidence && typeof entry.live_evidence === "object" && Object.keys(entry.live_evidence as object).length > 0 ? "available" : "none";
    const gaps = Array.isArray(entry.known_gaps) ? entry.known_gaps.slice(0, 2).join("; ") : "none";
    lines.push(`| ${entry.name} | ${entry.status} | ${entry.verification_level} | ${human} | ${machine} | ${evidence} | ${gaps.replaceAll("|", "\\|")} |`);
  }
  lines.push("", "## Current authoritative entry", "", "### MCP → Owner Command", "", "- Status: `VERIFIED`", "- Network Authorization: `VERIFIED`", "- Owner Session Binding: `VERIFIED`", "- `submitOwnerCommand`: `VERIFIED`", "- Router: `VERIFIED`", "- Capability Registry: `VERIFIED`", "- agent-host / LOCAL worker: `VERIFIED`", "- Result/Evidence return: `VERIFIED`", "- execution.run from Owner Command: `NOT_WIRED / NOT_VERIFIED`", "- Human document: [MCP_OWNER_COMMAND_CONNECTION.md](../dna-os-mcp/MCP_OWNER_COMMAND_CONNECTION.md)", "- Machine record: [connection-document.json](../dna-os-mcp/connection-document.json)", "", "## Projection rules", "", "- `VERIFIED`, `CONNECTED`, `NOT_VERIFIED`, `BLOCKED`, and `NOT_WIRED` are the only statuses.", "- A declaration without an authoritative semantic document is shown as `NOT_VERIFIED` with `DOCUMENT_MISSING`.", "- Existing configuration drift is shown as `BLOCKED`; no success is inferred.", "- Secret values are never copied into the index.", "", "## Missing authoritative connection documents", "", ...(index.missing_authoritative_documents as Json[]).map((entry) => `- \`${entry.connection_id}\` — ${entry.name} — \`${entry.status}\``), "", "Future connection documents must register by adding an authoritative `connection-document.json`; rerun the builder to project it here.");
  writeFileSync(HUMAN_OUT, `${lines.join("\n")}\n`, "utf8");
}

build();

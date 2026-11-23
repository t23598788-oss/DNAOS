import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(): Promise<void> {
const root = process.cwd();
const outputDir = path.join(root, "public/landing-preview");
const repository = "https://github.com/t23598788-oss/DNAOS";
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const generatedArtifacts = [
  "public/landing-preview/system-map.html",
  "public/landing-preview/system-map.json",
  "public/landing-preview/system-map.md",
  "public/landing-preview/assets/brand/dna-os/v1/",
  "workers/landing-entry/system-map-html.ts",
  "registry/architecture-book.json",
];
const dirty = porcelain.split("\n").filter(Boolean).some((line) => {
  const path = line.slice(3).replace(/^"|"$/g, "");
  return !generatedArtifacts.some((artifact) => artifact.endsWith("/") ? path.startsWith(artifact) : path === artifact);
});

const sources = [
  "workers/landing-entry/index.ts",
  "workers/landing-entry/wrangler.jsonc",
  "scripts/build-public-system-map.ts",
  "workers/auth-entry/index.ts",
  "workers/auth-entry/cloudflare.config.ts",
  "workers/business-onboarding/index.ts",
  "docs/CLOUDFLARE_SERVICE_ROUTE_MAP_2026-11-23.md",
  "docs/PRODUCTION_RELEASE_READINESS_2026-11-23.md",
  "public/landing-preview/assets/dna-os-logo-transparent.png",
  "public/landing-preview/brand-lock.json",
  "public/brand/dna-os/v1/brand-assets.json",
  "public/brand/dna-os/v1/README.md",
  "public/brand/dna-os/v1/dna-os-horizontal-color.png",
  "public/brand/dna-os/v1/dna-os-horizontal-color.svg",
  "public/brand/dna-os/v1/dna-os-horizontal-mono.png",
  "public/brand/dna-os/v1/dna-os-horizontal-mono.svg",
  "public/brand/dna-os/v1/dna-os-mark-color.png",
  "public/brand/dna-os/v1/dna-os-mark-color.svg",
  "public/brand/dna-os/v1/dna-os-mark-mono.png",
  "public/brand/dna-os/v1/dna-os-mark-mono.svg",
  "engines/connectors/registry.ts",
  "engines/connectors/providers/line.ts",
  "engines/connectors/providers/meta.ts",
  "engines/integration-gateway/selfDescription.ts",
  "engines/integration-gateway/adapters/line.ts",
  "engines/integration-gateway/adapters/meta.ts",
  "engines/integration-gateway/event-bus/bus.ts",
  "app/api/gateway/observe/line/route.ts",
  "app/api/gateway/observe/meta/route.ts",
  "registry/COMPUTE_RESOURCE_REGISTRY.json",
  "registry/infrastructure.json",
  "supabase/migrations/20261123000001_development_provenance_ledger.sql",
  "supabase/migrations/20261123000002_development_change_sets.sql",
];

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

function sourceLink(relativePath: string): string {
  return `${repository}/blob/${sourceRevision}/${relativePath}`;
}

const sourceEvidence = await Promise.all(sources.map(async (file) => {
  const contents = await read(file);
  let committedContents: string | null = null;
  try {
    committedContents = execFileSync("git", ["show", `${sourceRevision}:${file}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // A newly added source file has no GitHub blob at the pinned base revision yet.
  }
  const workingHash = createHash("sha256").update(contents).digest("hex");
  const committedHash = committedContents === null ? null : createHash("sha256").update(committedContents).digest("hex");
  return {
    path: file,
    sha256_working_tree: workingHash,
    sha256_at_pinned_revision: committedHash,
    matches_pinned_revision: committedHash === workingHash,
    github: committedHash === null ? null : sourceLink(file),
  };
}));

const gatewaySource = await read("engines/integration-gateway/selfDescription.ts");
const adapters = [...gatewaySource.matchAll(/\{\s*provider:\s*"([^"]+)",\s*observes:\s*\[([^\]]*)\],\s*ingress:\s*"(webhook|poll)"\s*\}/g)]
  .map((match) => ({
    provider: match[1],
    ingress: match[3],
    events: [...match[2].matchAll(/"([^"]+)"/g)].map((event) => event[1]),
    source: "engines/integration-gateway/selfDescription.ts",
  }));

const connectRegistry = await read("engines/connectors/registry.ts");
const connectProviders = [...connectRegistry.matchAll(/import\s*\{\s*(\w+ConnectContract)\s*\}\s*from\s*"\.\/providers\/(\w+)"/g)]
  .map((match) => ({ provider: match[2], contract_export: match[1], source: `engines/connectors/providers/${match[2]}.ts` }));

const migrationFiles = [
  "supabase/migrations/20261123000001_development_provenance_ledger.sql",
  "supabase/migrations/20261123000002_development_change_sets.sql",
];
const databaseObjects: { name: string; kind: string; migration: string }[] = [];
for (const migration of migrationFiles) {
  const sql = await read(migration);
  for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][\w]*\.[a-z_][\w]*)/gi)) {
    databaseObjects.push({ name: match[1], kind: "table", migration });
  }
  for (const match of sql.matchAll(/create\s+or\s+replace\s+function\s+([a-z_][\w]*\.[a-z_][\w]*)/gi)) {
    databaseObjects.push({ name: match[1], kind: "function", migration });
  }
}

const compute = JSON.parse(await read("registry/COMPUTE_RESOURCE_REGISTRY.json")) as { resources?: unknown[] };
const infrastructure = JSON.parse(await read("registry/infrastructure.json")) as { services?: Record<string, unknown> };
const workerConfig = await read("workers/landing-entry/wrangler.jsonc");
const authConfig = await read("workers/auth-entry/cloudflare.config.ts");
const deploymentEvidencePath = "docs/CLOUDFLARE_SERVICE_ROUTE_MAP_2026-11-23.md";
const deploymentEvidence = await read(deploymentEvidencePath);
const productionReadinessPath = "docs/PRODUCTION_RELEASE_READINESS_2026-11-23.md";
const productionReadiness = await read(productionReadinessPath);
const productionProjectRef = productionReadiness.match(/Supabase project `([a-z0-9]+)` already contained/)?.[1] ?? null;
const changeSetMigrationHash = productionReadiness.match(/Applied only `20261123000002_development_change_sets\.sql`[^\n]*SHA-256 is `([a-f0-9]{64})`/)?.[1] ?? null;
const productionDatabaseEvidence = {
  provider: "Supabase",
  environment: "production",
  project_ref: productionProjectRef,
  observed_on: "2026-11-23",
  migration_history: [
    { version: "20261123000001", status: "history_reconciled_after_existing_objects_were_verified", sql_execution_claimed: false },
    { version: "20261123000002", status: "applied_via_management_api", sql_sha256: changeSetMigrationHash },
  ],
  access_boundary: "public projection is read-only; private change-set records require authorized access; owner approval is checked against the exact company and organization binding",
  migration_graph: "divergent: older remote versions are absent from this checkout; no bulk db push was run",
  evidence: productionReadinessPath,
};
const brandPack = JSON.parse(await read("public/brand/dna-os/v1/brand-assets.json")) as {
  distribution_base_url: string;
  source_sha256: string;
  dimensions: { horizontal: number[]; mark: number[] };
  variants: Record<string, { horizontal: string; mark: string }>;
};

async function publishBrandPack(): Promise<void> {
  const source = path.join(root, "public/brand/dna-os/v1");
  const destination = path.join(outputDir, "assets/brand/dna-os/v1");
  await mkdir(destination, { recursive: true });
  for (const file of new Set(["brand-assets.json", "README.md", ...sources
    .filter((item) => item.startsWith("public/brand/dna-os/v1/"))
    .map((item) => path.basename(item))])) {
    await copyFile(path.join(source, file), path.join(destination, file));
  }
}
function deploymentObservation(service: string): { service: string; deployment_id: string; observed_at: string; evidence: string } | null {
  const line = deploymentEvidence.split("\n").find((item) => item.includes(`| \`${service}\` `));
  if (!line) return null;
  const match = line.match(/deployment `([^`]+)`, (\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)/);
  if (!match) return null;
  return { service, deployment_id: match[1], observed_at: new Date(`${match[2].replace(" UTC", "")}:00Z`).toISOString(), evidence: deploymentEvidencePath };
}

const manifest = {
  document: "DNA OS public system and integration map",
  schema_version: 1,
  generated_at: new Date().toISOString(),
  source: {
    repository: "t23598788-oss/DNAOS",
    revision: sourceRevision,
    working_tree_dirty_at_generation: dirty,
    github_revision_links_are_pinned_to: sourceRevision,
  },
  brand_assets: {
    manifest_url: `${brandPack.distribution_base_url}brand-assets.json`,
    base_url: brandPack.distribution_base_url,
    source_sha256: brandPack.source_sha256,
    recommended_document_header: {
      url: `${brandPack.distribution_base_url}${brandPack.variants.monochrome.horizontal}`,
      variant: "monochrome",
      display_width_px: 148,
    },
    assets: Object.fromEntries(Object.entries(brandPack.variants).map(([variant, files]) => [variant, {
      horizontal: `${brandPack.distribution_base_url}${files.horizontal}`,
      mark: `${brandPack.distribution_base_url}${files.mark}`,
    }])),
    provider_logo_rule: "External services use their own approved brand marks; DNA OS assets identify DNA OS only.",
  },
  boundaries: {
    production_deployments: "Observed deployment records are dated evidence; they do not prove this source revision is deployed.",
    database: "Migration files prove schema intent. Dated production evidence is shown with its own migration number, checksum, and evidence reference.",
    compute: "Compute entries are included only when registered in the provider-neutral compute registry; no resource payloads are published.",
    privacy: "This public map excludes credentials, business records, personal data, transaction payloads, and private account identifiers.",
  },
  services: [
    { name: "dnaos-homepage", layer: "Cloudflare Worker", configured_routes: ["https://dnaos.dev/", "https://dnaos.dev/assets/*", "https://dnaos.dev/system-map", "https://dnaos.dev/system-map.json", "https://dnaos.dev/system-map.md"], source: "workers/landing-entry/index.ts", configuration_source: "workers/landing-entry/wrangler.jsonc", source_state: workerConfig.includes('"name": "dnaos-homepage"') ? "configured_in_source" : "configuration_not_found", deployment_observation: deploymentObservation("dnaos-homepage") },
    { name: "dnaos-auth-entry", layer: "Cloudflare Worker", configured_routes: ["https://dnaos.dev/login", "https://dnaos.dev/start", "https://dnaos.dev/v1/auth/*"], source: "workers/auth-entry/index.ts", configuration_source: "workers/auth-entry/cloudflare.config.ts", source_state: authConfig.includes('name: "dnaos-auth-entry"') ? "configured_in_source" : "configuration_not_found", deployment_observation: deploymentObservation("dnaos-auth-entry") },
    { name: "dnaos-business-onboarding", layer: "shared source imported by auth Worker", source: "workers/business-onboarding/index.ts", source_state: "not_a_separately_deployed_worker_per_2026_11_23_inspection" },
  ],
  connection_pipeline: {
    sequence: ["provider webhook or poll", "signature/authentication boundary", "provider adapter normalization", "canonical Gateway event bus", "scoped authorized consumer"],
    adapters,
    connect_contracts: connectProviders,
    evidence: ["engines/integration-gateway/selfDescription.ts", "engines/integration-gateway/event-bus/bus.ts"],
  },
  identity_and_access: {
    rule: "A provider login proves identity; organization and business permissions are assigned within the user's authorized organization scope.",
    evidence: ["workers/auth-entry/index.ts", "workers/business-onboarding/index.ts", "engines/connectors/contract.ts"],
  },
  data_and_processing: {
    database_service: { name: "Supabase", evidence: ["services/supabase/server.ts", "supabase/migrations/"] },
    production_observation: productionDatabaseEvidence,
    provenance_ledger_objects: databaseObjects,
    compute_registry: { source: "registry/COMPUTE_RESOURCE_REGISTRY.json", registered_resources: (compute.resources ?? []).length, live_resource_details_published: false },
    infrastructure_service_names: Object.keys(infrastructure.services ?? {}).sort(),
    compute_runtime: "No live compute instance is claimed unless a resource is present in the registry and has fresh provider verification.",
  },
  source_files: sourceEvidence,
};

const md = [
  `<img src="${brandPack.distribution_base_url}${brandPack.variants.monochrome.horizontal}" alt="DNA OS" width="148" />`,
  "",
  `# ${manifest.document}`,
  "",
  `Generated at: ${manifest.generated_at}`,
  `Source revision: ${sourceRevision}${dirty ? " (working tree contained uncommitted changes at generation)" : ""}`,
  "",
  "## Production services",
  ...manifest.services.map((service) => `- **${service.name}** — ${service.layer}; ${Array.isArray(service.configured_routes) ? service.configured_routes.join(", ") : service.source_state}. Source: [${service.source}](${sourceLink(service.source)}).`),
  "",
  "## Connection pipeline",
  manifest.connection_pipeline.sequence.map((step, index) => `${index + 1}. ${step}`).join("\n"),
  "",
  `Gateway adapters in source: ${adapters.map((adapter) => `${adapter.provider} (${adapter.ingress}: ${adapter.events.join(", ")})`).join("; ")}.` ,
  `Connect contracts in source: ${connectProviders.map((provider) => provider.provider).join(", ")}. A registered contract does not prove a live account is connected.`,
  "",
  "## Database and compute",
  `Supabase migration objects in the provenance ledger: ${databaseObjects.map((object) => `${object.kind} ${object.name}`).join(", ")}.`,
  `Production Supabase migration evidence (observed ${productionDatabaseEvidence.observed_on}): project ${productionProjectRef}; 20261123000002 was applied with SQL SHA-256 ${changeSetMigrationHash}; 20261123000001 history was reconciled after existing objects were verified. Older remote migration versions diverge from this checkout, and no bulk migration push was run. Evidence: [${productionReadinessPath}](${sourceLink(productionReadinessPath)}).`,
  `Registered compute resources: ${manifest.data_and_processing.compute_registry.registered_resources}. Live instance status is not claimed unless recorded and freshly verified.`,
  "",
  "## Evidence limits",
  "Deployment IDs are dated observations from the cited service map and may predate this source revision. The public JSON lists paths and SHA-256 hashes only; it excludes secrets, customer data, financial payloads, and private account identifiers.",
  "",
  "Machine-readable version: [system-map.json](/system-map.json)",
  "Brand kit: [manifest](https://dnaos.dev/assets/brand/dna-os/v1/brand-assets.json) · [usage notes](https://dnaos.dev/assets/brand/dna-os/v1/README.md)",
].join("\n");

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!);
}

const serviceRows = manifest.services.map((service) => {
  const deployment = service.deployment_observation && typeof service.deployment_observation === "object"
    ? (service.deployment_observation as { deployment_id?: string; observed_at?: string }).deployment_id ?? "Source only"
    : "Source only";
  return `<tr><th>${escapeHtml(service.name)}</th><td>${escapeHtml(service.layer)}</td><td>${escapeHtml(Array.isArray(service.configured_routes) ? service.configured_routes.join(", ") : service.source_state)}</td><td>${escapeHtml(deployment)}</td><td><a href="${sourceLink(service.source)}">${escapeHtml(service.source)}</a></td></tr>`;
}).join("");
const adapterRows = adapters.map((adapter) => `<tr><th>${escapeHtml(adapter.provider)}</th><td>${escapeHtml(adapter.ingress)}</td><td>${escapeHtml(adapter.events.join(", "))}</td><td>Source-defined adapter</td></tr>`).join("");
const objectRows = databaseObjects.map((object) => `<tr><td>${escapeHtml(object.kind)}</td><td><code>${escapeHtml(object.name)}</code></td><td><a href="${sourceLink(object.migration)}">${escapeHtml(object.migration)}</a></td></tr>`).join("");
const fileRows = sourceEvidence.map((file) => `<tr><td><a href="${file.github ?? "#"}">${escapeHtml(file.path)}</a></td><td><code>${escapeHtml(file.sha256_working_tree)}</code></td></tr>`).join("");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DNA OS System Map</title><style>
:root{color-scheme:light;--ink:#17202d;--muted:#596575;--line:#dce2e9;--paper:#fff;--wash:#f6f8fa;--blue:#2463a8}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.55 Inter,Arial,sans-serif}main{max-width:1000px;margin:0 auto;padding:34px 26px 64px}.doc-head{display:flex;align-items:center;gap:20px;border-bottom:1px solid var(--line);padding:0 0 20px;margin-bottom:30px}.doc-head img{width:148px;height:auto}.doc-head small{color:var(--muted);letter-spacing:.11em;font-size:11px;font-weight:700}h1{font-size:32px;line-height:1.18;margin:0 0 10px}h2{font-size:19px;margin:0 0 12px}p{color:var(--muted);margin:6px 0 14px}.meta{font-size:13px;color:var(--muted)}.live{border-left:3px solid #738399;padding:10px 14px;background:#f0f3f6;margin:20px 0 28px;font-size:13px}.actions{display:flex;gap:16px;margin:12px 0 28px}.actions a,a{color:var(--blue);text-decoration:none}.actions a:hover,a:hover{text-decoration:underline}section{margin:28px 0;padding-top:18px;border-top:1px solid var(--line)}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid var(--line);padding:9px 10px}th{font-weight:650}code{font-size:12px;overflow-wrap:anywhere}.steps{display:flex;flex-wrap:wrap;gap:7px;list-style:none;margin:0;padding:0}.steps li{background:#eef2f6;border:1px solid var(--line);padding:7px 10px;border-radius:3px;font-size:13px}.steps li+li:before{content:'→';color:var(--muted);padding-right:12px}details{margin-top:16px}summary{cursor:pointer;font-weight:650}.note{font-size:13px}.footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:620px){main{padding:22px 16px 44px}.doc-head{align-items:flex-start;flex-direction:column;gap:8px}h1{font-size:26px}.steps{display:grid}.steps li+li:before{content:''}}
</style></head><body><main>
<header class="doc-head"><img src="${brandPack.distribution_base_url}${brandPack.variants.monochrome.horizontal}" alt="DNA OS"><small>SYSTEM AND INTEGRATION REFERENCE</small></header>
<h1>DNA OS system map</h1><p>Production routes, source code, integration boundaries, database evidence, and compute registry.</p>
<div class="meta">Source revision <code>${sourceRevision}</code> · generated ${escapeHtml(manifest.generated_at)}</div>
<div class="live">Served by <strong>dnaos-homepage</strong> · Worker version <code>__DNAOS_WORKER_VERSION__</code> · created <code>__DNAOS_WORKER_CREATED_AT__</code></div>
<nav class="actions"><a href="/system-map.json">Machine-readable JSON</a><a href="/system-map.md">Markdown</a><a href="${brandPack.distribution_base_url}README.md">DNA OS brand kit</a></nav>
<section><h2>Production services and source</h2><div class="table-wrap"><table><thead><tr><th>Service</th><th>Layer</th><th>Routes or state</th><th>Observed deployment</th><th>Source</th></tr></thead><tbody>${serviceRows}</tbody></table></div><p class="note">Deployment IDs are dated observations; the source revision may be newer. A configured source route alone does not prove a live provider account.</p></section>
<section><h2>Connection path</h2><ol class="steps">${manifest.connection_pipeline.sequence.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol><div class="table-wrap"><table><thead><tr><th>Adapter</th><th>Ingress</th><th>Observed event types in source</th><th>Evidence status</th></tr></thead><tbody>${adapterRows}</tbody></table></div><p class="note">Connect contracts: ${connectProviders.map((item) => escapeHtml(item.provider)).join(", ")}. A contract in source does not mean an account is linked or that every operation is active.</p></section>
<section><h2>Production database and processing</h2><p><strong>Supabase · ${escapeHtml(productionProjectRef)} · observed ${escapeHtml(productionDatabaseEvidence.observed_on)}</strong></p><p>Migration 20261123000002 was applied through the Management API. SQL SHA-256: <code>${escapeHtml(changeSetMigrationHash)}</code>. Migration 20261123000001 history was reconciled after existing objects were verified; execution of that SQL is not claimed. Older remote migration versions diverge from this checkout and no bulk migration push was run.</p><p class="note">Database evidence: <a href="${sourceLink(productionReadinessPath)}">${productionReadinessPath}</a></p><div class="table-wrap"><table><thead><tr><th>Object</th><th>Name</th><th>Migration source</th></tr></thead><tbody>${objectRows}</tbody></table></div><p>Registered compute resources: <strong>${manifest.data_and_processing.compute_registry.registered_resources}</strong>. No live compute resource is claimed from an empty registry.</p></section>
<section><h2>Source integrity</h2><p>Each linked file includes its SHA-256 in the machine-readable map. Hashes are evidence of file content, not authorization to access private service data.</p><details><summary>View source files and hashes</summary><div class="table-wrap"><table><thead><tr><th>Source file</th><th>Working-tree SHA-256</th></tr></thead><tbody>${fileRows}</tbody></table></div></details></section>
<footer class="footer">DNA OS · Public technical reference · Personal and business records are not included.</footer>
</main></body></html>`;

await mkdir(outputDir, { recursive: true });
await publishBrandPack();
await writeFile(path.join(outputDir, "system-map.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outputDir, "system-map.md"), `${md}\n`);
await writeFile(path.join(outputDir, "system-map.html"), `${html}\n`);
await writeFile(path.join(root, "workers/landing-entry/system-map-html.ts"), `// purpose: Generated public HTML for the source-backed DNA OS system map, served by the landing Worker.\nexport const systemMapHtml = ${JSON.stringify(`${html}\n`)};\n`);
console.log(`Generated public system map at ${outputDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(): Promise<void> {
const root = process.cwd();
const outputDir = path.join(root, "public/landing-preview");
const repository = "https://github.com/t23598788-oss/DNAOS";
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const porcelain = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
const dirty = porcelain.trim().length > 0;

const sources = [
  "workers/landing-entry/index.ts",
  "workers/landing-entry/wrangler.jsonc",
  "scripts/build-public-system-map.ts",
  "workers/auth-entry/index.ts",
  "workers/auth-entry/cloudflare.config.ts",
  "workers/business-onboarding/index.ts",
  "docs/CLOUDFLARE_SERVICE_ROUTE_MAP_2026-11-23.md",
  "docs/PRODUCTION_RELEASE_READINESS_2026-11-23.md",
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
  boundaries: {
    production_deployments: "Observed deployment records are dated evidence; they do not prove this source revision is deployed.",
    database: "Migration files prove schema intent in source. They do not prove application to a live Supabase project.",
    compute: "Compute entries are included only when registered in the provider-neutral compute registry; no resource payloads are published.",
    privacy: "This public map excludes credentials, business records, personal data, transaction payloads, and private account identifiers.",
  },
  services: [
    { name: "dnaos-homepage", layer: "Cloudflare Worker", configured_routes: ["https://dnaos.dev/", "https://dnaos.dev/assets/*", "https://dnaos.dev/system-map.json", "https://dnaos.dev/system-map.md"], source: "workers/landing-entry/index.ts", configuration_source: "workers/landing-entry/wrangler.jsonc", source_state: workerConfig.includes('"name": "dnaos-homepage"') ? "configured_in_source" : "configuration_not_found", deployment_observation: deploymentObservation("dnaos-homepage") },
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
].join("\n");

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "system-map.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outputDir, "system-map.md"), `${md}\n`);
console.log(`Generated public system map at ${outputDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

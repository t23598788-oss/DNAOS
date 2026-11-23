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
  "public/landing-preview/system-map-ai.zip",
  "public/landing-preview/system-map-ai-README.md",
  "public/landing-preview/assets/brand/dna-os/v1/",
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
    { name: "dnaos-homepage", layer: "Cloudflare Worker", configured_routes: ["https://dnaos.dev/", "https://dnaos.dev/assets/*", "https://dnaos.dev/system-map", "https://dnaos.dev/system-map.json", "https://dnaos.dev/system-map.md", "https://dnaos.dev/system-map-ai.zip"], source: "workers/landing-entry/index.ts", configuration_source: "workers/landing-entry/wrangler.jsonc", source_state: workerConfig.includes('"name": "dnaos-homepage"') ? "configured_in_source" : "configuration_not_found", deployment_observation: deploymentObservation("dnaos-homepage") },
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

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DNA OS System Map</title><style>
:root{color-scheme:light;--ink:#17202d;--muted:#596575;--line:#dce2e9;--wash:#f6f8fa;--blue:#2463a8;--card:#fff}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:16px/1.6 Inter,Arial,sans-serif}main{max-width:1000px;margin:0 auto;padding:36px 26px 64px}.doc-head{display:flex;align-items:center;gap:18px;padding:0 0 18px;margin-bottom:30px}.doc-head img{width:112px;height:auto}.doc-head small{color:var(--muted);letter-spacing:.1em;font-size:12px;font-weight:700}h1{font-size:34px;line-height:1.2;margin:0 0 10px}h2{font-size:19px;margin:0 0 4px}p{color:var(--muted);margin:6px 0 14px}.meta{font-size:13px;color:var(--muted)}.live{padding:10px 0;margin:14px 0 22px;font-size:13px;color:var(--muted)}.actions{display:flex;flex-wrap:wrap;gap:18px;margin:16px 0 30px}.actions a,a{color:var(--blue);text-decoration:none}.actions a:hover,a:hover{text-decoration:underline}.download{display:inline-flex;background:#2463a8;color:#fff!important;padding:10px 16px;border-radius:5px;font-weight:700}.categories{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.category{background:var(--card);border:1px solid var(--line);padding:18px 20px;border-radius:8px}.category p{font-size:14px;margin:4px 0 0}.footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:620px){main{padding:24px 16px 48px}.doc-head{align-items:flex-start;flex-direction:column;gap:8px}h1{font-size:28px}.categories{grid-template-columns:1fr}}
</style><style>.brand-images{display:flex;flex-wrap:wrap;gap:14px;margin-top:14px}.brand-images a{display:grid;gap:6px;min-width:180px;color:var(--muted);font-size:13px}.brand-image-preview{display:flex;align-items:center;width:184px;height:80px;padding:10px;border-radius:8px;background:transparent}.brand-image-preview img{width:100%;height:100%;object-fit:contain;object-position:center}.brand-image-color-logo{background:#07152b}</style></head><body><main>
<header class="doc-head"><img src="${brandPack.distribution_base_url}${brandPack.variants.monochrome.horizontal}" alt="DNA OS"><small>SYSTEM AND INTEGRATION REFERENCE</small></header>
<h1>DNA OS system map</h1><p>Production routes, source code, integration boundaries, database evidence, and compute registry.</p>
<div class="meta">Source revision <code>${sourceRevision}</code> · generated ${escapeHtml(manifest.generated_at)}</div>
<nav class="actions"><a class="download" href="/system-map-ai.zip" download>Download AI reference package (.zip)</a><a href="/system-map.json">JSON map</a><a href="/system-map.md">Markdown reference</a><a href="${brandPack.distribution_base_url}README.md">DNA OS brand kit</a></nav>
<section><div class="categories">
<article class="category"><h2>Production services</h2><p><a href="${sourceLink("workers/landing-entry/index.ts")}">Homepage</a> · <a href="${sourceLink("workers/auth-entry/index.ts")}">Login and identity</a> · <a href="${sourceLink("docs/CLOUDFLARE_SERVICE_ROUTE_MAP_2026-11-23.md")}">Service routes</a></p></article>
<article class="category"><h2>Business connections</h2><p><a href="${sourceLink("engines/connectors/registry.ts")}">Connector registry</a> · <a href="${sourceLink("engines/integration-gateway/selfDescription.ts")}">Gateway and events</a> · <a href="${sourceLink("engines/integration-gateway/event-bus/bus.ts")}">Event flow</a></p></article>
<article class="category"><h2>Database and records</h2><p><a href="${sourceLink("supabase/migrations/20261123000001_development_provenance_ledger.sql")}">Provenance ledger</a> · <a href="${sourceLink("supabase/migrations/20261123000002_development_change_sets.sql")}">Change sets</a> · <a href="${sourceLink(productionReadinessPath)}">Production evidence</a></p></article>
<article class="category"><h2>Compute and infrastructure</h2><p><a href="${sourceLink("registry/COMPUTE_RESOURCE_REGISTRY.json")}">Compute registry</a> · <a href="${sourceLink("registry/infrastructure.json")}">Infrastructure registry</a></p></article>
<article class="category"><h2>Brand assets</h2><p><a href="${brandPack.distribution_base_url}README.md">Usage guide</a> · <a href="${brandPack.distribution_base_url}brand-assets.json">Asset manifest</a></p></article>
<article class="category"><h2>Full machine-readable index</h2><p><a href="/system-map.json">Routes, integrations, database objects, and source hashes</a> · <a href="/system-map.md">Readable reference</a></p></article>
</div></section>
<section><h2>Brand image files</h2><p>Each image is a separate static file. Open a file directly or use its asset link.</p><div class="brand-images">
<a href="${brandPack.distribution_base_url}${brandPack.variants.color.horizontal}"><span class="brand-image-preview brand-image-color-logo"><img src="${brandPack.distribution_base_url}${brandPack.variants.color.horizontal}" alt="DNA OS colorful horizontal logo"></span><span>Color logo · PNG</span></a>
<a href="${brandPack.distribution_base_url}${brandPack.variants.monochrome.horizontal}"><span class="brand-image-preview"><img src="${brandPack.distribution_base_url}${brandPack.variants.monochrome.horizontal}" alt="DNA OS monochrome horizontal logo"></span><span>Monochrome logo · PNG</span></a>
<a href="${brandPack.distribution_base_url}${brandPack.variants.color.mark}"><span class="brand-image-preview"><img src="${brandPack.distribution_base_url}${brandPack.variants.color.mark}" alt="DNA OS colorful D mark"></span><span>Color mark · PNG</span></a>
<a href="${brandPack.distribution_base_url}${brandPack.variants.monochrome.mark}"><span class="brand-image-preview"><img src="${brandPack.distribution_base_url}${brandPack.variants.monochrome.mark}" alt="DNA OS monochrome D mark"></span><span>Monochrome mark · PNG</span></a>
</div></section>
<footer class="footer">DNA OS · Public technical reference · Personal and business records are not included.</footer>
</main></body></html>`;

await mkdir(outputDir, { recursive: true });
await publishBrandPack();
await writeFile(path.join(outputDir, "system-map.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outputDir, "system-map.md"), `${md}\n`);
const aiReadme = `# DNA OS AI reference package\n\nGenerated: ${manifest.generated_at}\nSource revision: ${sourceRevision}\n\nThis package contains a public system map and brand asset index for AI-assisted reading. It is generated ahead of time and downloaded as a static file. It does not include application source code, credentials, private account data, customer records, or transaction payloads.\n\nFiles:\n- system-map.md — concise human and AI-readable overview\n- system-map.json — structured service, integration, database, and source evidence\n- brand-assets.json — approved DNA OS asset variants and usage boundaries\n`;
await writeFile(path.join(outputDir, "system-map-ai-README.md"), aiReadme);
const archivePath = path.join(outputDir, "system-map-ai.zip");
const archiveScript = "import sys, zipfile\nout, *files = sys.argv[1:]\nwith zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:\n  for name, path in zip(files[::2], files[1::2]):\n    z.write(path, name)\n";
execFileSync("python3", ["-c", archiveScript, archivePath,
  "README.md", path.join(outputDir, "system-map-ai-README.md"),
  "system-map.md", path.join(outputDir, "system-map.md"),
  "system-map.json", path.join(outputDir, "system-map.json"),
  "brand-assets.json", path.join(outputDir, "assets/brand/dna-os/v1/brand-assets.json"),
]);
await writeFile(path.join(outputDir, "system-map.html"), `${html}\n`);
console.log(`Generated public system map at ${outputDir}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

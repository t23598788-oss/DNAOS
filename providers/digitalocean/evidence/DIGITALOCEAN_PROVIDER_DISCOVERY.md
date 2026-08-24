# DigitalOcean Provider Discovery — Machine-Readable Knowledge Pack

Date: 2026-08-17. **Corrected 2026-08-17** (Spaces access-key finding — see DATA/Spaces section and UNKNOWN_GAPS; original finding was wrong, re-verified via direct fetch of `docs.digitalocean.com/reference/api/reference/spaces-keys/`, HTTP 200).
Scope: **read-only discovery only**. No DigitalOcean account was created, no login performed, no API token created, no resource created/modified/deleted, no money spent. All findings sourced from official DigitalOcean documentation (`docs.digitalocean.com`, `digitalocean.com`, DigitalOcean's public OpenAPI spec, and DigitalOcean's own `llms.txt`) via four parallel read-only research passes, executed 2026-08-17.

This is the first instance of a reusable **provider knowledge pack** template (see project memory `project_provider_knowledge_pack_initiative`) — the same 6-category structure and per-fact evidence-record schema is intended to be reused for future providers (AWS, Google Cloud, Vast.ai, etc.) rather than redesigned each time.

**This document is evidence/discovery only.** No connector, adapter, or capability folder was created from it — per the Owner's explicit instruction, implementation is a separate, later, explicitly-authorized step.

---

## 1. DIGITALOCEAN_PROVIDER_REGISTRY

```
PROVIDER: DigitalOcean

AUTH
- Personal Access Token (PAT) — scoped, immutable scopes after creation, user-set expiry
- OAuth 2.0 — authorization-code flow, 30-day access token TTL, refresh token issued
- Custom Scopes — resource:action taxonomy (see SCOPE_MATRIX)
- Spaces Access Key/Secret — SEPARATE credential type for data-plane calls (AWS Sig v4), NOT a DO OAuth/PAT scope. **Key *creation/management* itself, however, is a standard v2 API resource (`/v2/spaces/keys`, `spaces_key:*` scopes) — corrected 2026-08-17, see DATA section**
- Inference bearer auth — SEPARATE credential type for the AI/Inference API host

ACCOUNT_MODEL
- Team-based (not individual-account-based) — all resources/billing scoped to a Team
- Organization — optional layer grouping multiple Teams under consolidated billing (free)
- Project — resource-grouping layer within a Team, URN-addressed (do:resource_type:id)
- Payment method required on the Team before any billable resource can be created

COMPUTE
- Droplets
- GPU Droplets (same API as Droplets — no separate resource type)
- Bare Metal GPUs (real, distinct product — NO REST API; sales/contract-provisioned only)
- App Platform
- Kubernetes (DOKS)

DATA
- Managed Databases: PostgreSQL, MySQL, Kafka, MongoDB, OpenSearch, Valkey (all 6 confirmed real; Redis being phased toward Valkey per DO's own messaging)
- Spaces (S3-compatible object storage — separate API host + credential type for data-plane calls; access-key **creation/management is API-automatable** via `/v2/spaces/keys` on the standard v2 API — corrected 2026-08-17)
- Volumes / Block Storage

NETWORKING
- VPC (+ VPC Peering)
- Load Balancers (regional; "Global Load Balancers" existence as a separate resource vs. a flag — unconfirmed, see gaps)
- Cloud Firewalls
- Domains / DNS (Domain Records)
- Reserved IPs (formerly "Floating IPs", renamed 2022-06-16; legacy endpoints still function as aliases)

AI
- Serverless Inference (stateless call API, separate host inference.do-ai.run)
- Dedicated Inference (full CRUD, standard v2 API host — public preview)
- Batch Inference (async jobs, separate host inference.do-ai.run)
- Agent Platform (branded "GradientAI Platform" / "Gradient AI Agent Platform" — full CRUD for agents + knowledge bases, standard v2 API host)

CONTROL
- REST API — https://api.digitalocean.com/v2/, bearer auth, 5000 req/hr + 250 req/min per token (community-sourced figure, flagged for spot-check)
- doctl — official CLI, thin wrapper storing a PAT per named "context"
- MCP Server — official, DO-hosted (Remote) or self-run (Local); 9 remote services live: Accounts, App Platform, Databases, Kubernetes, Droplets, Insights, Marketplace, Networking, Spaces; auth = same PAT bearer token
- llms.txt — https://docs.digitalocean.com/llms.txt — CONFIRMED REAL, curated AI-facing doc index with explicit tool-preference guidance (see CHANGE_INTELLIGENCE)
- No general-purpose webhooks/events API found across the platform (explicit absence, not a research gap)

BILLING
- balance — GET /v2/customers/my/balance
- invoices — GET /v2/customers/my/invoices (+ csv/pdf/summary variants)
- billing history — GET /v2/customers/my/billing_history
- usage/cost insights — GET /v2/billing/{account_urn}/insights/{start_date}/{end_date}
- no dedicated pricing-catalog API — price_monthly/price_hourly fields on /v2/sizes (and equivalent per-product endpoints) are the only programmatic pricing source

AUTOMATION
- create / read / update / delete — real for nearly every resource above (see AUTOMATION_CAPABILITY_MAP for exceptions)
- start/stop/rebuild — real for Droplets (power_on/power_off/shutdown/reboot/power_cycle) and App Platform (restart/rollback); Kubernetes has node-pool "recycle" as the closest equivalent, no cluster-level stop
- logs — real for App Platform only; NOT found for Droplets, Databases, or Kubernetes
- monitoring — real for Droplets (CPU/bandwidth/memory/load metrics); PARTIAL for App Platform (bandwidth only); not found for Databases/Kubernetes at cluster level
- alerts — real, Monitoring Alert Policies API (/v2/monitoring/alerts)

EVIDENCE
- source URL — every record below cites its real docs.digitalocean.com (or api spec) URL
- last verified — 2026-08-17 for all records in this pack
- API version — v2 for the core REST API; inference/Spaces/OAuth use separate hosts and their own versioning
- required scope — recorded where documented; explicitly marked "not documented" where DO's docs didn't state it (never invented — see SCOPE_MATRIX and UNKNOWN_GAPS)
```

---

## 2. DIGITALOCEAN_API_ACTION_MAP

*LAST_VERIFIED_DATE for every record below: 2026-08-17. SCOPE = REQUIRED_SCOPE. AUTOMATABLE = YES/NO/PARTIAL. Source URLs are DigitalOcean's official docs unless noted.*

### AUTH / ACCOUNT / CLI

| RESOURCE | ACTION | ENDPOINT | METHOD | SCOPE | AUTOMATABLE | SOURCE | NOTES |
|---|---|---|---|---|---|---|---|
| Personal Access Token | create | Control Panel: Account → API → Tokens | N/A | N/A | PARTIAL | [create-personal-access-token](https://docs.digitalocean.com/reference/api/create-personal-access-token/) | Scope is fixed at creation, cannot be edited later (must issue a new token) |
| Personal Access Token | authenticate request | applies to all /v2 endpoints | N/A | N/A | YES | same | `Authorization: Bearer <token>`; PAT and OAuth tokens are indistinguishable to resource endpoints |
| OAuth | authorize (auth-code flow) | `https://cloud.digitalocean.com/v1/oauth/authorize` | GET | N/A | NO (interactive) | [oauth](https://docs.digitalocean.com/reference/api/oauth/) | params: client_id, redirect_uri, response_type, scope, state |
| OAuth | exchange code for token | `https://cloud.digitalocean.com/v1/oauth/token` | POST | N/A | YES | same | returns access_token, expires_in=2592000 (30 days), refresh_token |
| REST API | base connection | `https://api.digitalocean.com/v2/` | any | N/A | YES | [API overview](https://docs.digitalocean.com/reference/api/) | single `/v2/` path segment; no active v1 for core API |
| REST API | rate limiting | header-based, per token | N/A | N/A | YES | community Q&A restating docs (flagged, not directly re-verified) | 5000/hr, 250/min; check `ratelimit-remaining` header |
| doctl | install | N/A | N/A | N/A | YES | [install doctl](https://docs.digitalocean.com/reference/doctl/how-to/install/) | package manager or binary |
| doctl | authenticate | `doctl auth init` | N/A | N/A (uses token's own scopes) | YES | [doctl auth init](https://docs.digitalocean.com/reference/doctl/reference/auth/init/) | stores PAT under named "context"; multi-account via `--context` |
| MCP Server | overview | N/A | N/A | N/A | YES | [MCP servers](https://docs.digitalocean.com/reference/mcp/) | 9 remote services: Accounts, App Platform, Databases, Kubernetes, Droplets, Insights, Marketplace, Networking, Spaces |
| MCP Server | authenticate (remote) | e.g. `https://apps.mcp.digitalocean.com/mcp`, `https://databases.mcp.digitalocean.com/mcp` (one subdomain per service) | MCP protocol | N/A (rides on PAT scopes) | YES | [configure MCP](https://docs.digitalocean.com/reference/mcp/configure-mcp/) | bearer PAT in client config headers |
| Project | list/create/manage resources | `/v2/projects`, `/v2/projects/{id}/resources` | GET/POST | not independently confirmed | YES | [Projects reference](https://docs.digitalocean.com/products/projects/reference/), [Project Resources API](https://docs.digitalocean.com/reference/api/reference/project-resources/) | resources referenced by URN `do:resource_type:resource_id` |
| Team/Org | N/A (structural) | N/A | N/A | N/A | NO | [Teams](https://docs.digitalocean.com/platform/teams/), [Organizations](https://docs.digitalocean.com/platform/organizations/) | payment method required on Team before billable resource creation or additional member invites |

### COMPUTE — Droplets (GPU Droplets use the identical API — see notes)

| ACTION | ENDPOINT | METHOD | SCOPE | AUTOMATABLE | SOURCE | NOTES |
|---|---|---|---|---|---|---|
| LIST | `/v2/droplets` | GET | `droplet:read` | YES | [Droplets](https://docs.digitalocean.com/reference/api/reference/droplets/) | GPU Droplets listed here too — no separate resource type |
| GET | `/v2/droplets/{id}` | GET | `droplet:read` | YES | same | |
| CREATE | `/v2/droplets` | POST | `droplet:create` | YES | same | GPU Droplets: same endpoint, GPU-enabled size slug + region |
| UPDATE (resize) | `/v2/droplets/{id}/actions` (type=resize) | POST | `droplet:update`, `droplet:create` | YES | [Droplet Actions](https://docs.digitalocean.com/reference/api/reference/droplet-actions/) | disk resize requires power-off; CPU/RAM-only can be live |
| UPDATE (rename) | `/v2/droplets/{id}/actions` (type=rename) | POST | `droplet:update` | YES | same | |
| DELETE | `/v2/droplets/{id}` | DELETE | `droplet:delete` | YES | [Droplets](https://docs.digitalocean.com/reference/api/reference/droplets/) | bulk via `?tag_name=`; full cleanup via `.../destroy_with_associated_resources/dangerous` |
| START/STOP/REBOOT | `/v2/droplets/{id}/actions` (power_on/power_off/shutdown/reboot/power_cycle) | POST | `droplet:update` | YES | [Droplet Actions](https://docs.digitalocean.com/reference/api/reference/droplet-actions/) | shutdown = graceful ACPI, may not always succeed; bulk via `/v2/droplets/actions?tag_name=` |
| status | `/v2/droplets/{id}/actions/{action_id}` | GET | `droplet:read` | YES | same | droplet object itself carries a `status` field too |
| monitoring | `/v2/monitoring/metrics/droplet/{cpu,bandwidth,filesystem,memory_*,load_*}` | GET | not confirmed | YES | [Droplet metrics](https://docs.digitalocean.com/products/monitoring/concepts/metrics/) | requires DO Metrics Agent installed on the Droplet |
| logs | — | — | — | **NO** | — | no API-exposed console/system log retrieval found for Droplets |
| regions/sizes | `/v2/regions`, `/v2/sizes` | GET | not confirmed | YES | [Regions](https://docs.digitalocean.com/reference/api/reference/regions/) | `/v2/sizes` also returns `price_monthly`/`price_hourly` |

### COMPUTE — Bare Metal GPUs

| ACTION | ENDPOINT | AUTOMATABLE | SOURCE | NOTES |
|---|---|---|---|---|
| ALL (list/get/create/update/delete/start-stop/logs/status/monitoring) | **none found** | **NO** | [GPU product comparison](https://docs.digitalocean.com/products/bare-metal-gpus/concepts/gpu-product-comparison/), [create how-to](https://docs.digitalocean.com/products/bare-metal-gpus/how-to/create/) | Real, distinct product (dedicated 8-GPU single-tenant servers, NVIDIA HGX H100/H200, AMD MI300X; NYC1/AMS3 only) but **sales/contract-provisioned, not self-service** — zero REST API surface. A connector must treat this as "request via sales," not automatable. |

### COMPUTE — App Platform

| ACTION | ENDPOINT | METHOD | SCOPE | AUTOMATABLE | NOTES |
|---|---|---|---|---|---|
| LIST | `/v2/apps` | GET | `app:read` | YES | |
| GET | `/v2/apps/{id}` | GET | `app:read` | YES | |
| CREATE | `/v2/apps` | POST | `app:create` | YES | body = AppSpec object |
| UPDATE | `/v2/apps/{id}` | PUT | `app:update` | YES | |
| DELETE | `/v2/apps/{id}` | DELETE | `app:delete` | YES | |
| restart (start/stop-equivalent) | `/v2/apps/{id}/restart` | POST | `app:update` | YES | no distinct "stop"; restart is closest |
| rollback | `/v2/apps/{id}/rollback` | POST | `app:update` | YES | |
| logs | `/v2/apps/{id}/logs`, `/v2/apps/{id}/deployments/{deployment_id}/logs`, `/v2/apps/{id}/logs/aggregate` | GET | not separated from `app:read` (unconfirmed) | YES | **only compute resource with real log API** |
| status | `/v2/apps/{id}/deployments/{deployment_id}` (phase field) | GET | `app:read` | YES | |
| monitoring | `/v2/apps/{id}/metrics/bandwidth_daily` | GET | not confirmed | PARTIAL | bandwidth only; no CPU/memory metrics endpoint found |
| regions/sizes | `/v2/apps/regions`, `/v2/apps/instance-sizes[/{slug}]` | GET | not confirmed | YES | |

Source: [Apps API reference](https://docs.digitalocean.com/reference/api/reference/apps/)

### COMPUTE — Kubernetes (DOKS)

| ACTION | ENDPOINT | METHOD | SCOPE | AUTOMATABLE | NOTES |
|---|---|---|---|---|---|
| LIST | `/v2/kubernetes/clusters` | GET | `kubernetes:read` | YES | |
| GET | `/v2/kubernetes/clusters/{id}` | GET | `kubernetes:read` | YES | |
| CREATE | `/v2/kubernetes/clusters` | POST | `kubernetes:create` | YES | requires ≥1 node pool with ≥1 worker |
| UPDATE / upgrade | `/v2/kubernetes/clusters/{id}` (PUT), `.../upgrade` (POST) | PUT/POST | `kubernetes:update` | YES | |
| DELETE | `/v2/kubernetes/clusters/{id}` | DELETE | `kubernetes:delete` | YES | `.../associatedResources`, `.../destroy_with_associated_resources/dangerous` variants exist |
| node pool "recycle" (closest start/stop equivalent) | `/v2/kubernetes/clusters/{id}/node_pools/{pool_id}/recycle` | POST | `kubernetes:update` | YES | no cluster-level stop |
| status | `/v2/kubernetes/clusters/{id}/status` | GET | `kubernetes:read` | YES | |
| logs / cluster-level metrics | — | — | — | **NO** | not found as dedicated DOKS REST resources |
| node pools (full CRUD) | `/v2/kubernetes/clusters/{id}/node_pools[/{pool_id}]` | GET/POST/PUT/DELETE | `kubernetes:read`/`update` | YES | |
| kubeconfig/credentials | `/v2/kubernetes/clusters/{id}/kubeconfig`, `.../credentials`, `.../user` | GET | `kubernetes:read` | YES | |
| regions/sizes/versions | `/v2/kubernetes/options` | GET | not confirmed | YES | single call returns all three |

Source: [Kubernetes API reference](https://docs.digitalocean.com/reference/api/reference/kubernetes/)

### DATA — Managed Databases (PostgreSQL / MySQL / Kafka / MongoDB / OpenSearch / Valkey — one shared API, `engine` field distinguishes)

| ACTION | ENDPOINT | METHOD | AUTOMATABLE | SOURCE | NOTES |
|---|---|---|---|---|---|
| LIST / GET | `/v2/databases`, `/v2/databases/{uuid}` | GET | YES | [API reference index](https://docs.digitalocean.com/reference/api/reference/) | 71 total endpoints in the Databases group |
| CREATE | `/v2/databases` | POST | YES | [Create PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/how-to/create/) | fields: name, engine, version, region, size, num_nodes; PG supports v14–18 |
| DELETE | `/v2/databases/{uuid}` | DELETE | YES | | |
| RESIZE | `/v2/databases/{uuid}/resize` | PUT | YES | [Resize PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/how-to/resize/) | documented per-engine too |
| ADD READ REPLICA | `/v2/databases/{uuid}/replicas` | POST | YES | [Add read-only nodes](https://docs.digitalocean.com/products/databases/postgresql/how-to/add-read-only-nodes/) | Postgres/MySQL/Mongo; Kafka/OpenSearch/Valkey use different scaling models |
| connection pools (PG only) | `.../pools` (path segment PARTIALLY confirmed) | POST/DELETE | PARTIAL | [Connection pools](https://docs.digitalocean.com/products/databases/postgresql/how-to/manage-connection-pools/) | PGBouncer-backed; verify exact segment before building |
| users / firewall rules / backups | sub-resources under `/v2/databases/{uuid}/...` | mixed | PARTIAL | [Databases reference](https://docs.digitalocean.com/reference/api/reference/databases/) | existence confirmed (part of the 71-endpoint group), exact paths not individually verified |
| Kafka topic management | `.../topics` (inferred) | not confirmed | PARTIAL | referenced via DO's MCP server description | needs direct confirmation |
| options (validate inputs before CREATE) | `/v2/databases/options` | GET | YES | | valid engine/region/size/version combinations |
| logs / metrics | — | — | **NO** (not found) | | no dedicated REST endpoint; status is a field (`creating`/`online`) not a separate endpoint |
| SCOPE | not documented for any Databases action in fetched pages | | | | flagged in UNKNOWN_GAPS |

### DATA — Spaces (S3-compatible object storage)

| ACTION | ENDPOINT | AUTOMATABLE | SOURCE | NOTES |
|---|---|---|---|---|
| bucket/object CRUD | `https://{region}.digitaloceanspaces.com` (S3-compatible, regional — **NOT** under api.digitalocean.com/v2) | YES | [Spaces API reference](https://docs.digitalocean.com/reference/api/spaces/) | auth = Spaces access-key/secret (AWS Sig v4), separate credential type |
| CORS | S3 `PutBucketCors` (XML) | YES | [Configure CORS](https://docs.digitalocean.com/products/spaces/how-to/configure-cors/) | |
| bucket policy | S3-compatible policy PUT | YES (once keys exist) | [Manage access](https://docs.digitalocean.com/products/spaces/how-to/manage-access/) | |
| access-key CREATE | `/v2/spaces/keys` | POST | `spaces_key:create_credentials` | YES | [Spaces Keys](https://docs.digitalocean.com/reference/api/reference/spaces-keys/) | **Corrected 2026-08-17** (original finding was wrong): key creation IS API-automatable, on the *standard v2 API* (not the S3-compatible host), using normal OAuth/PAT bearer auth. Directly re-verified via raw fetch (HTTP 200, real page). Also confirmed real via `doctl spaces keys create <name>` ([doctl reference](https://docs.digitalocean.com/reference/doctl/reference/spaces/keys/create/), found via search but not independently re-fetched — see gaps) and Terraform's `digitalocean_spaces_key` resource. |
| access-key LIST/GET/UPDATE/DELETE | `/v2/spaces/keys`, `/v2/spaces/keys/{access_key}` | GET/PUT/PATCH/DELETE | `spaces_key:read` / `spaces_key:update` / `spaces_key:delete` | YES | same | Full CRUD confirmed present on the same page; note a possible scope-naming inconsistency in the docs — both `spaces_key:create_credentials` (singular resource) and `spaces_keys:create` (plural) appear in the page's scope list; use `spaces_key:create_credentials` unless directly disproven. |

### DATA — Volumes / Block Storage

| ACTION | ENDPOINT | METHOD | AUTOMATABLE | SOURCE |
|---|---|---|---|---|
| LIST/CREATE/DELETE | `/v2/volumes` | GET/POST/DELETE | YES | [Volumes reference](https://docs.digitalocean.com/products/volumes/reference/) |
| ATTACH/DETACH/RESIZE | `/v2/volumes/{id}/actions` | POST | YES | [Block Storage Actions](https://docs.digitalocean.com/products/volumes/reference/api/block-storage-actions/) |
| SNAPSHOT | `/v2/volumes/{id}/snapshots` (create), `/v2/snapshots` (list/get/delete, shared with Droplet snapshots) | POST/GET/DELETE | YES | [Increase volume size](https://docs.digitalocean.com/products/volumes/how-to/increase-size/) — grow-only, no shrink |

### NETWORKING

| RESOURCE | ACTION | ENDPOINT | METHOD | AUTOMATABLE | SOURCE | NOTES |
|---|---|---|---|---|---|---|
| VPC | CREATE | `/v2/vpcs` | POST | YES | [VPCs](https://docs.digitalocean.com/reference/api/reference/vpcs/) | requires name, region, ip_range CIDR |
| VPC | LIST/GET/DELETE/members | `/v2/vpcs[/{id}][/members]` | GET/DELETE | YES | same | delete only succeeds with zero attached members |
| VPC | peering | `/v2/vpc_peerings` (inferred) | POST/GET/DELETE | PARTIAL | [VPC Peering how-to](https://docs.digitalocean.com/products/networking/vpc/how-to/create-peering/) | exact path not independently confirmed |
| Load Balancers | full CRUD | `/v2/load_balancers[/{id}]` | POST/GET/PUT/DELETE | YES | [Load Balancers](https://docs.digitalocean.com/reference/api/reference/load-balancers/) | 10 endpoints total |
| Load Balancers | add/remove droplets, forwarding rules | `.../droplets`, `.../forwarding_rules` | POST/DELETE | YES | [Manage LBs](https://docs.digitalocean.com/products/networking/load-balancers/how-to/manage/) | new Droplets start DOWN until health check passes |
| Load Balancers | "Global Load Balancers" | unclear if separate resource | — | PARTIAL | | not confirmed distinct from regional LB object |
| Cloud Firewalls | full CRUD | `/v2/firewalls[/{id}]` | POST/GET/PUT/DELETE | YES | [Firewalls](https://docs.digitalocean.com/reference/api/reference/firewalls/) | 11 endpoints total |
| Cloud Firewalls | rules, droplets, tags | `.../rules`, `.../droplets`, `.../tags` | POST/DELETE | YES | [Configure rules](https://docs.digitalocean.com/products/networking/firewalls/how-to/configure-rules/), [Manage droplets](https://docs.digitalocean.com/products/networking/firewalls/how-to/manage-droplets/) | tag-based application recommended for fleets |
| Domains | CREATE/LIST/GET/DELETE | `/v2/domains[/{name}]` | POST/GET/DELETE | YES | [Domains](https://docs.digitalocean.com/reference/api/reference/domains/) | no UPDATE — domains immutable, only records editable |
| Domain Records | full CRUD | `/v2/domains/{name}/records[/{id}]` | POST/GET/PUT-PATCH/DELETE | YES | [Domain Records](https://docs.digitalocean.com/reference/api/reference/domain-records/) | required fields vary per record type (A/AAAA/CNAME/MX/TXT/SRV/NS/CAA) |
| Reserved IPs | CREATE/LIST/GET/DELETE | `/v2/reserved_ips[/{ip}]` | POST/GET/DELETE | YES | [Reserved IPs](https://docs.digitalocean.com/reference/api/reference/reserved-ips/) | 4 endpoints; legacy `/v2/floating_ips` still works as alias |
| Reserved IPs | assign/unassign | `.../actions` | POST | YES | [Reserved IP Actions](https://docs.digitalocean.com/reference/api/reference/reserved-ip-actions/) | |

### AI — Inference & Agent Platform (branded "GradientAI Platform")

| RESOURCE | ACTION | ENDPOINT | METHOD | SCOPE | AUTOMATABLE | SOURCE | NOTES |
|---|---|---|---|---|---|---|---|
| Serverless Inference | chat completions | `https://inference.do-ai.run/v1/chat/completions` | POST | `inference_bearer_auth` | YES | [Serverless Inference](https://docs.digitalocean.com/reference/api/reference/serverless-inference/) | **separate host**, not api.digitalocean.com/v2 |
| Serverless Inference | models/embeddings/images/responses/messages/async-invoke | `/v1/{models,embeddings,images/generations,responses,messages,async-invoke}` | mixed | `inference_bearer_auth` | YES | same | stateless call surface, no CRUD/DELETE |
| Dedicated Inference | full CRUD + accelerators/tokens/ca-certificate/sizes/gpu-model-config | `/v2/dedicated-inferences[/{id}][/...]` | GET/POST/PATCH/DELETE | `dedicated_inference:read/create/update/delete` | YES | [Dedicated Inference](https://docs.digitalocean.com/reference/api/reference/dedicated-inference/) | standard v2 host; public preview |
| Batch Inference | file upload / job CRUD / results / cancel | `https://inference.do-ai.run/v1/batches[/files][/{id}][/results][/cancel]` | mixed | `inference_bearer_auth` (unconfirmed if this alone suffices) | YES | [Batch Inference](https://docs.digitalocean.com/reference/api/reference/batch-inference/) | separate host; 24hr window; JSONL ≤200MB/50k requests |
| Agent Platform | agents full CRUD + keys/routes/status/usage/versions | `/v2/gen-ai/agents[/{id}][/...]` | GET/POST/PUT/DELETE | `genai:read/create/update/delete` | YES | [GradientAI Platform](https://docs.digitalocean.com/reference/api/reference/gradientai-platform/) | standard v2 host; includes multi-agent routing, guardrails, RAG |
| Agent Platform | knowledge bases + data sources | `/v2/gen-ai/knowledge-bases[/{id}][/data-sources[/{id}]]` | GET/POST/PUT/DELETE | `genai:read/create/update/delete` | YES | same | |
| Agent Platform | models / regions (discovery) | `/v2/gen-ai/models`, `/v2/gen-ai/regions` | GET | not confirmed | YES | same | available foundation models, GPU-region availability |

---

## 3. DIGITALOCEAN_SCOPE_MATRIX

**Confirmed real taxonomy:** `resource:action` (colon-delimited), action ∈ {read, create, update, delete} plus resource-specific extras (e.g. `database:view_credentials`).

**Two alias scopes** (auto-expand as DO adds endpoints, not selectable in the Custom-Scopes UI picker — only via a direct token-creation API call; UI instead shows "Read Only"/"Full Access" buttons):
- `api:read` = every read scope
- `api:write` = every scope (full access)

**Real scope strings actually found in official docs (this pass):**
```
droplet:read, droplet:create, droplet:update, droplet:delete
database:read, database:create, database:update, database:view_credentials
vpc:read, vpc:create
firewall:update
load_balancer:delete
block_storage:read
spaces:update
snapshot:delete
billing:read
dedicated_inference:read, dedicated_inference:create, dedicated_inference:update, dedicated_inference:delete
genai:read, genai:create, genai:update, genai:delete
app:read, app:create, app:update, app:delete
kubernetes:read, kubernetes:create, kubernetes:update, kubernetes:delete
```

**Inferred-but-not-independently-confirmed** (follow the same pattern, character-for-character strings not verified against the live OpenAPI spec):
```
monitoring:read, monitoring:create, monitoring:update, monitoring:delete
account:read (for /v2/account, incl. droplet_limit)
```

**Not a `resource:action` scope at all — separate credential systems:**
- Spaces: AWS Signature v4 access-key/secret pair
- Inference (Serverless/Batch): `inference_bearer_auth` bearer scheme, accepts `dop_v1_*` (PAT), `doo_v1_*`/`dor_v1_*` (OAuth), or `agent_access_key` (agent-scoped — not interchangeable with account-level tokens)

**Token lifecycle facts:** scopes are immutable after PAT creation (must issue a new token to change scope); OAuth access tokens expire in exactly 2,592,000 seconds (30 days) with a refresh_token issued; team role changes retroactively affect Read-Only/Full-Access PATs but NOT Custom-Scope PATs.

---

## 4. DIGITALOCEAN_BILLING_MAP

| RESOURCE | ACTION | ENDPOINT | METHOD | SCOPE | AUTOMATABLE | NOTES |
|---|---|---|---|---|---|---|
| Balance | get | `/v2/customers/my/balance` | GET | `billing:read` | YES | returns account_balance, month_to_date_balance, month_to_date_usage, generated_at |
| Invoices | list/get/csv/pdf/summary | `/v2/customers/my/invoices[/{uuid}][/csv,/pdf,/summary]` | GET | `billing:read` | YES | monthly-generated; a "preview" (current, unfinalized) invoice is also accessible |
| Billing History | list | `/v2/customers/my/billing_history` | GET | `billing:read` | YES | payments/invoices/credits granted; paginated; links to Invoices via invoice_uuid |
| Usage/Cost Insights | get | `/v2/billing/{account_urn}/insights/{start_date}/{end_date}` | GET | `billing:read` | YES | closest thing to per-resource cost breakdown; exact response granularity unconfirmed |
| Agent Usage (product-specific) | get | `/v2/gen-ai/agents/{id}/usage` | GET | `genai:read` | YES | scoped to Agent Platform only, not account-wide cost |
| Pricing catalog | — | **no dedicated pricing API** | — | — | NO | use `price_monthly`/`price_hourly` fields off `/v2/sizes` and equivalent per-product size/plan endpoints instead |
| Promo/credit balance | — | folded into `/v2/customers/my/balance`'s `account_balance` | GET | `billing:read` | PARTIAL | dedicated "credits remaining" breakout field not confirmed |

---

## 5. DIGITALOCEAN_AUTOMATION_CAPABILITY_MAP

| Resource | LIST | GET | CREATE | UPDATE | DELETE | Start/Stop | Logs | Monitoring |
|---|---|---|---|---|---|---|---|---|
| Droplets / GPU Droplets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Bare Metal GPUs | ❌ | ❌ | ❌ (sales only) | ❌ | ❌ | ❌ | ❌ | ❌ |
| App Platform | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (restart) | ✅ | ⚠️ (bandwidth only) |
| Kubernetes | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ (node-pool recycle only) | ❌ | ❌ (cluster-level) |
| Managed Databases (all 6 engines) | ✅ | ✅ | ✅ | ✅ (resize) | ✅ | n/a | ❌ | ❌ |
| Spaces (data-plane: buckets/objects) | ✅ (once keys exist) | ✅ | ✅ (buckets) | ✅ | ✅ | n/a | n/a | n/a |
| Spaces access keys (control-plane, `/v2/spaces/keys`) | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a | n/a |
| Volumes | ✅ | ✅ | ✅ | ✅ (resize/attach) | ✅ | n/a | n/a | n/a |
| VPC / Load Balancers / Firewalls / Domains / Reserved IPs | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a | n/a |
| Serverless / Dedicated / Batch Inference | ✅ (Dedicated only) | ✅ | ✅ | ✅ (Dedicated) | ✅ (Dedicated) | n/a | n/a | n/a |
| Agent Platform | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a | ✅ (usage) |
| Billing | n/a | ✅ | n/a | n/a | n/a | n/a | n/a | n/a |
| Monitoring Alert Policies | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a | n/a |

✅ = documented and automatable · ⚠️ = partial/limited · ❌ = confirmed absent, not automatable

---

## 6. DIGITALOCEAN_UNKNOWN_GAPS

**Scope strings not independently confirmed** (pattern known, exact characters not verified against live OpenAPI spec):
- Databases (any action), Regions, Sizes, Monitoring Alert Policies, VPC Peering, sub-resources of Dedicated/Batch Inference and Agent Platform (keys/routes/versions specifically)

**Endpoints referenced but not independently fetched/confirmed:**
- Database connection-pool exact path segment (`/pools` vs `/connection_pools`)
- Database users/firewall-rules/backups exact sub-resource paths (existence confirmed, paths not)
- Kafka topic-management endpoint (referenced via DO's own MCP description, not directly fetched)
- VPC Peering exact endpoint (`/v2/vpc_peerings` is an inference, not confirmed)
- Global Load Balancers — unclear if a distinct resource or a flag on the regional Load Balancer object
- Status page component/incident-list endpoints (`components.json`, `incidents.json` — standard Statuspage.io convention, not DO-specific-confirmed)
- ~~`/v2/account`'s `droplet_limit` field~~ **RESOLVED 2026-08-17**: directly re-fetched `docs.digitalocean.com/reference/api/reference/account/` (HTTP 200) — confirmed `GET /v2/account`, scope `account:read`, response includes `droplet_limit`. Added as a real record to `../definition/actions.json`.

**Policy/process facts not fully enumerated:**
- Full PAT expiration interval options (an interval must be chosen; the complete option list wasn't enumerated in the fetched page)
- Full OAuth refresh-token rotation policy/endpoint
- Exact account-creation requirements (email/phone verification) — inferred only indirectly from billing/team docs, not a dedicated signup-requirements page
- Whether Batch Inference truly needs nothing beyond `inference_bearer_auth`, or also requires an `agent_access_key` specifically
- `doctl spaces keys create` — corroborated via a real, dated DigitalOcean doctl-reference URL found through search, but the page itself returned HTTP 503 on direct re-fetch attempts this session (docs.digitalocean.com appears to have been rate-limiting/throttling repeated fetches); not independently re-confirmed by raw content, only by the API-level `/v2/spaces/keys` page (which WAS independently re-confirmed, HTTP 200)
- Exact scope string for Spaces key creation: page lists both `spaces_key:create_credentials` and `spaces_keys:create` (singular vs. plural resource name) — DigitalOcean's own docs may have a naming inconsistency here; do not assume one is a typo without a live test

**Explicitly confirmed absences (not gaps — real findings):**
- No general-purpose webhooks/events API anywhere in the platform (DO Monitoring explicitly does not support webhooks as an alert destination, per community docs corroborating the absence)
- No dedicated pricing-catalog API (must derive from per-product size/plan list endpoints)
- No logs API for Droplets, Databases, or Kubernetes (App Platform is the only compute resource with one)
- Bare Metal GPUs has zero REST API surface (sales-provisioned only)

**Correction applied 2026-08-17:** the original pass reported "Spaces access-key creation is not API-automatable (control-panel only)" — this was **wrong** and has been corrected throughout this document. Spaces key creation/management is real and automatable via `/v2/spaces/keys` on the standard v2 API (`spaces_key:*` scopes), confirmed by direct raw fetch of the live docs page (HTTP 200) plus corroborating `doctl spaces keys create` and Terraform `digitalocean_spaces_key` references. The S3-compatible data-plane (bucket/object operations) still requires the separate AWS-Sig-v4 access-key/secret credential — that part of the original finding was correct and unchanged; only the "can the *key itself* be created via API" claim was wrong.

**Cross-cutting note for future connector builders:** the rate-limit figures (5000/hr, 250/min) came from a community page restating docs rather than a page this research directly fetched from docs.digitalocean.com — worth a final spot-check before being relied on as authoritative, alongside every item above marked "not independently confirmed."

---

*Research method: 4 parallel read-only agents against official DigitalOcean documentation only. Zero DigitalOcean account actions taken. This report is discovery/evidence only — no connector, adapter, or capability folder was created from it.*

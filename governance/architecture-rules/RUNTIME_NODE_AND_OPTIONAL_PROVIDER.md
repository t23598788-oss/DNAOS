# Runtime nodes and optional providers

**status: VOCABULARY FROZEN — 2026-09-11 Owner sequence steps 1–2**
**executable contract:** `contracts/architecture/runtime-node-and-optional-provider.ts`
**not a lifecycle stage:** companion to this folder (same class as `STRUCTURE_LOCK_MAP.md`)
**does not unlock:** `control/owner-command/contract.ts`, `control/computer-use-authority/lease.ts`, `software/repository-registry/types.ts`
**destination / placement / working-tree map:** [`runtime-v1/`](./runtime-v1/) — DOCX prose is not executable law; this file remains CURRENT vocabulary. Step 7 adapter/boundary plan (not implementation): [`runtime-v1/STEP-7-ADAPTER-BOUNDARY.md`](./runtime-v1/STEP-7-ADAPTER-BOUNDARY.md).

---

## Step 1 — OPTIONAL_PROVIDER

Railway and Vercel may host or observe DNA OS processes. They are **not**:

- execution authority
- command-minting authority
- source authority
- the software registry
- a required runtime

Canonical roles:

| provider | architectural role |
|---|---|
| Railway | `OPTIONAL_PROVIDER` |
| Vercel | `OPTIONAL_PROVIDER` |
| GitHub | `SOURCE_AUTHORITY` |
| Supabase | `DATA_SERVICE` (persistence / human Auth at the console — not Core execution) |

`.railway/railway.ts` is deployment configuration. `connections/railway/` is a read adapter. `connections/vercel/` remains NOT_YET_BUILT. Presence of any of these files does not make the provider Core.

Unknown providers are `UNKNOWN_PROVIDER` — never treated as Core by default.

---

## Step 2 — two node kinds

| kind | meaning | examples |
|---|---|---|
| `CORE_NODE` | Portable compute: Node HTTP + JSONL + policy + leases | `control/owner-command`, `control/command-router`, `control/agent-gateway`, `software/repository-registry`, `permissions/write-gate`, `permissions/execution-policy`, `control/computer-use-authority`, `transport/owner-command-http`, circuit, joint-monitor, MCP adapter |
| `MAC_LOCAL_AGENT` | Must stay on a Mac with GUI/Keychain/launchd | `connections/os-ui`, `control/computer-use-executor`, `credentials/macos-keychain`, `control/runtime-control`, `control/machine-observation`, voice, local-runtime, macos-native-bridge |

Computer-use **leases** are Core. Computer-use **execution** and screen/CGEvent are Mac Local Agent.

Unclassified folders stay `UNCLASSIFIED` until explicitly named. Do not invent a third node kind to paper over mixed files (`server.ts` is Core listen + Mac routes in one process — that split is sequence step 3, not this document).

---

## Sequence (status lives in runtime-v1 CURRENT-MAP)

This vocabulary file does not implement later steps. Working-tree status of
steps 3–6 vs origin/main is recorded in
[`runtime-v1/CURRENT-MAP.md`](./runtime-v1/CURRENT-MAP.md), not here.

Declared later work (do not skip; do not delete Railway IAC in vocabulary):

7. Remove hardcoded `*.railway.app` from runtime decisions  
8. Take Railway off the critical path  

Then later (placement map): Postgres authority, durable jobs, release split,
worker isolation, DNA Git, HA, region.

---

## What this is not

- Not a new provider registry (identity stays `software/provider-project-registry/`)
- Not a new repository registry
- Not `DNA_OS_RUNTIME` env schema (bind policy already lives in `permissions/network-auth-gate/`)
- Not an instruction to filesystem-lock `server.ts`

# control/alert-correlation/

**หน้าที่:** turn a provider's alert EMAIL into a correlated incident state,
by weighing the email's CLAIM against a real system FACT observed right now.

```
EMAIL -> parseAlertEmail -> resolveTarget -> assessIncident (live probe)
      -> classifyAlert (dedup) -> OwnerIncidentReport
```

**Duplicate Gate (2026-08-26, before any file was written):** searched the
repo for an existing email connector, inbox/message read contract,
notification ingestion, and any incident/alert capability. Result: **none
exist.** No `connections/email`, no `connections/gmail`, no
`control/incident`, no `AlertEvent`/`incident_state` type anywhere, and no
mail credential in `credentials/`. This capability is new, not a parallel
pipeline.

**Input:** `RawAlertEmail[]` (source-agnostic) + currently-open incidents.
**Output:** `OwnerIncidentReport[]` — see `./pipeline.ts`.
**Dependency ที่อนุญาต:** `./types.ts`, `./parse.ts`, `./resolve.ts`,
`./correlate.ts`, `./dedup.ts`, `./host-runtime.ts`.

## The one rule

**An email is a claim, never a verdict.** Every incident state is derived
in `./correlate.ts` from a live HTTP observation this capability performs
itself. Proven live: Railway emailed *"Build failed for
DNA-OS-INFRASTRUCTURE / dna-os-circuit"* at `06:19:17Z`; the service
answers **HTTP 200** now, so the state is `ALERT_HISTORICAL_RECOVERED`,
not an outage.

## THE INGESTION SEAM — the honest blocker

This capability **reads no mailbox**, by design and by necessity.

`RawAlertEmail` is a plain record any reader can produce. That seam
exists because of a real, unresolved constraint:

> **DNA OS has no email credential and no non-AI path to a mailbox.**
> `credentials/` contains nothing for Gmail/IMAP/SMTP. The only working
> reader on this machine is the Gmail connector bound to a Claude
> session — which means a human or an AI session must invoke the fetch.

So the Owner's rule *"AI ไม่ต้องนั่ง polling inbox"* is **only partly
satisfied today**:

| Requirement | Status |
|---|---|
| AI makes no incident decision | ✅ enforced — proven by test G1, a source scan of every decision-path file |
| Pipeline is deterministic software | ✅ parse/resolve/correlate/dedup are pure + one self-performed probe |
| Correlation runs without waiting on AI | ✅ `runAlertCorrelation` takes a batch already in hand |
| **Ingestion runs without AI** | ❌ **UNRESOLVED** — no stored credential exists |

Closing it needs a stored Gmail credential (OAuth refresh token via
`credentials/`) plus a worker that calls the Gmail API directly. That is
a separate, credential-scoped task and was **not** built here — inventing
a mail client without a credential would produce a component that cannot
run.

## Why dedup does NOT use thread_id

Real mail forced this. Gmail thread `1a03cb91688a2d24` contains **four**
Railway "Build failed" messages covering **two different services**
(`dna-os-circuit` ×2, `owner-command-http` ×2) — Railway threads by
subject, and the subject names only the project. Keying on the thread
would merge two genuine incidents into one and silently lose an outage.

Identity is `provider | project | service | alert_type | window`.
`thread_id` and `message_id` are deliberately excluded — see
`./dedup.ts`'s header. Test cases B1–B5 prove it.

## Honest gaps

- **Railway is the only provider with a body parser.** Its plaintext
  format was read from live mail. Every other provider gets identity +
  subject classification, with body fields `UNKNOWN` — rather than a
  speculative parser written against a format nobody has seen.
- **`deployment_id` is usually `UNKNOWN`.** Railway embeds it in a query
  string that the plaintext conversion mangles (observed: `?id 25ec48-…`,
  `?id>3fd504-…`). A strict UUID match is required, so a mangled id
  yields `UNKNOWN` instead of a wrong id.
- **`KNOWN_SERVICES` is a hand-verified table, not a registry read.**
  Three rows, each with a repo path re-checked on every resolve. It is
  not wired to `software/registry-database/`; a service missing from it
  yields `UNRESOLVED_ALERT`, which is honest but manual.
- **No persistence.** `OpenIncident[]` is passed in and returned through;
  nothing is written to disk, so dedup across runs needs a caller-owned
  store. Deliberate — this folder decides, it does not own storage.
- **Requires Node ≥18** for global `fetch` (matching `package.json`'s
  `engines`). The machine default is v16.20.2, so run the proof with a
  v18+ node on PATH.

## Verification

```
npx tsc --noEmit                                                    # clean
npx tsx control/alert-correlation/tests/runtime-proof.test.ts       # 22 passed, 0 failed
```

The proof uses **real emails** — real `message_id`s, `thread_id`,
timestamps and bodies read from live Gmail on 2026-08-26 — and performs a
**real HTTP probe** against the real Railway host.

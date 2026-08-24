# Architecture Decision Record — research-engine connection

## ADR-RE-001: local HTTP adapter, no vendored source, static-registry CONNECTED with a per-request live health check

**Status:** Decided (this round). Scope: connect / health-check / read
latest result only — matches `../github/`'s own "read-only bootstrap"
precedent (ADR-GH-001), applied to a plain local HTTP JSON API instead of
GitHub's REST API.

### Context

DNA-LAB-PERMISSION-REASONER's Research & Evaluation Engine runs as a real
local process, reachable in this environment at `http://localhost:8787`,
exposing two read-only endpoints:
`GET /api/research/health` and `GET /api/research/latest`. Its own source
is not present in this checkout (`repo_id: "DNA-RESEARCH-ENGINE"` was the
previous NOT_CONNECTED registry entry's marker) — this adapter must know
only the HTTP contract (URL shape + JSON shape), never import or vendor
anything from that repo, matching `../../control/command-router/capability-registry.ts`'s
own header rule ("never add a repo_id ... that points at a real local
path" for repos not present in this checkout — this adapter's `repo_id`
stays `"DNA-OS-INFRASTRUCTURE"`, the same convention `permission-reasoner`'s
entry already established for "the callable surface lives here, the thing
it talks to does not").

### Decision 1 — this repo owns the adapter, not the service

`connections/research-engine/` contains only: HTTP client code
(`research-read-api.ts`), response validation (`payload-validation.ts`),
and the entry point (`research-engine-adapter.ts`). Nothing in this folder
can run the research engine itself, start an experiment, or write to
`research.db` — there is no method parameter on `hostFetch` at all (see
`./host-runtime.ts`), so a write call is not merely disallowed by
convention, it is absent from the type signature.

### Decision 2 — offline is BLOCKED, never mocked

A connection refused, a timeout, a non-2xx status, or a failed health check
all resolve to `status: "BLOCKED"` with warning `RESEARCH_ENGINE_OFFLINE`.
No branch in `research-engine-adapter.ts` can produce a `COMPLETED` result
without a real, parsed HTTP 200 body from `/api/research/latest` — there is
no fixture/mock data path compiled into this capability at all. This
mirrors this repo's existing no-silent-failure discipline
(`../../contracts/command/routing-result.ts`,
`../../permissions/execution-policy/types.ts`'s `ExecutionPermissionDecision`):
a stop for a real reason is reported as that reason, never smoothed over.

### Decision 3 — health-check-then-read, in that order, always

`fetchResearchEngineLatestResult` calls `/api/research/health` first and
only calls `/api/research/latest` if that health check reports healthy.
This is a small correctness choice, not a performance one: it means a step
that fails is always attributable to "the service itself is down" (health
check failed) vs. "the service is up but its latest-result endpoint/body is
broken" (health ok, latest malformed) — two different facts a caller may
want to react to differently, so they are never collapsed into one
undifferentiated failure.

### Decision 4 — registry `CONNECTED` means "adapter exists and is wired," not "reachable right now"

`../../control/command-router/capability-registry.ts`'s existing convention
(inherited from `github`/`execution`/`permission-reasoner`) is
**static-at-registration**: `health_status` is a hardcoded field checked by
reading the file, proving a real callable contract exists in this repo
today. That convention cannot express "is the real external process up at
this exact moment" — a fact that changes between two calls a second apart,
which a static field can never represent honestly.

Rather than inventing a THIRD `health_status` value (which would break
`../../control/command-router/types.ts`'s two-value union and every
existing reader of it), this adapter keeps the static field as `CONNECTED`
(true today: the adapter exists, is wired into `../router.ts`, and was
verified against a real running server — see `../README.md`'s evidence
section) and adds the LIVE signal as a separate, per-request mechanism:
`../router.ts`'s `runResearchEngineStep` calls
`fetchResearchEngineLatestResult`, which does its own live health check
before every read and resolves to `BLOCKED` + `RESEARCH_ENGINE_OFFLINE`
whenever the real service is unreachable, regardless of what the static
registry says. `checkResearchEngineLiveHealth()` is also exported
separately for any future caller that wants a bare boolean without paying
for a full latest-result read.

**What this does NOT do:** it does not change `CapabilityHealthStatus` from
its existing two-value union, does not add a `health_status: "connected but
maybe not really"` third state, and does not make the registry poll
`http://localhost:8787` at import time (a registry is data, loaded once;
making it perform I/O at module-load time would make every test/tool that
merely reads the registry silently depend on a live external process,
which is exactly the kind of hidden coupling `../github/ARCHITECTURE_DECISIONS.md`
already argues against for a different reason).

### Consequences

A caller that only reads `CAPABILITY_REGISTRY["research-engine"].health_status`
learns "this capability is wired" — true always, once this ADR's code is in
the tree. A caller that actually routes a command through
`routeOwnerCommand` gets the real-time truth, because `runResearchEngineStep`
never skips its own live check. The two questions ("is the code wired" vs.
"is the service up") stay answerable independently, matching how a human
would actually ask them.

### Sources

Live `curl` output against `http://localhost:8787/api/research/health` and
`http://localhost:8787/api/research/latest`, captured during this round
(2026-08-16) — see `../README.md`'s "หลักฐานจริง" section for the exact
observed payload shape this ADR and `../payload-validation.ts` are built
against.

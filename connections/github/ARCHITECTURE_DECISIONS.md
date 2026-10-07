# Architecture Decision Record — GitHub Authentication

## ADR-GH-001: Fine-grained PAT is the bootstrap credential; GitHub App is the target architecture

**Status:** Decided (Owner, 2026-08-14). GitHub App is **NOT_YET_BUILT** — this record exists to name the destination and the trigger conditions, not to implement it.

### Context

`connections/github/` today authenticates as a single fine-grained Personal Access Token (`GITHUB_PAT_INFRASTRUCTURE`, enforced as the one accepted credential channel — `ARCHITECTURE_DECISIONS` cross-ref: `POLICY.md` P-GH-013). This matches the capability's actual current use case: one Owner, one repository, read-only.

But this repo's own stated architecture is not single-owner. `permissions/software-scope/account.ts` and `account-tenant-assignment.ts` model many Accounts, each with its own Tenant; `contracts/identity/envelope-identity.ts`'s `EnvelopeIdentity` carries `acting_as_account_id` on every single Command and Event, by design, so that "whose scope is this" is answered per-request, never assumed. The root README states Infrastructure is "the layer every domain (business or external) connects through" — plural, by construction.

A fine-grained PAT cannot serve that model. Documented, not inferred: *"Each token is limited to access resources owned by a single user or organization."* ([Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)) One credential, one resource owner — permanently, not as a current limitation of this capability's code.

Three further documented facts sharpen why this is a hard architectural boundary, not a preference:

1. **Multi-owner is GitHub's own stated App use case.** *"If you want to access GitHub resources on behalf of a user or in an organization, or you anticipate a long-lived integration, we recommend building a GitHub App."* ([Deciding when to build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app))
2. **Rate limits pool per person for a PAT, per installation for an App.** A PAT's 5,000 requests/hour counts against *the Owner's own personal limit*, shared across every token the Owner holds — meaning multiple tenants sharing one PAT would silently contend with each other and with the Owner's own unrelated GitHub usage. An App installation token's limit is separately scoped per installation.
3. **GitHub Check Runs — publishing pass/fail status onto a commit or PR — cannot be created by a PAT at all**, documented verbatim: *"To create a check run, you must use a GitHub App. OAuth apps and authenticated users are not able to create a check suite."* ([Check runs](https://docs.github.com/en/rest/checks/runs)) `governance/release-gate/`'s stated purpose (gate a deploy, report why) points directly at this capability once it needs to publish its verdict back onto GitHub itself rather than just log it internally.

### Decision

- **Now:** Fine-grained PAT (`GITHUB_PAT_INFRASTRUCTURE`), single channel, least-privilege per capability (see `CHANGE_PLAN_API_VERSION.md` and the 2026-08-14 capability-audit report for the exact permission set: `Metadata: read` + `Contents: read` for what's built today). This is the correct, documented choice for the current single-owner, read-only use case — not a stopgap to feel bad about.
- **Migration trigger — any ONE of these three, whichever comes first:**
  1. A second Account/Tenant (per `permissions/software-scope/`) needs its own GitHub scope, distinct from the Owner's.
  2. `governance/release-gate/` (or any future capability) needs to publish a GitHub Check Run — structurally impossible with a PAT, not a permission to request.
  3. Any write capability (push/commit/PR/release) is approved to run in production, where credential lifetime and blast radius matter more than they do for today's read-only diagnostics.
- **Until a trigger fires:** no GitHub App work is authorized. This ADR names the destination so the seam is built correctly *now*, not so the App gets built early.

### Consequences

**What this already protects, at zero extra cost:** `credential-resolution.ts` returns an opaque `credential_source` string (`"env:GITHUB_PAT_INFRASTRUCTURE"` today) rather than exposing the token's shape to callers. That boundary is exactly where a GitHub App's short-lived installation token would arrive later (e.g. `credential_source: "app_installation:<id>"`) without `github-read-api.ts` or `status-operations.ts` needing to change at all — the credential *source* is already abstracted from how it's *used*. Keeping that seam clean between now and the migration trigger is cheap; re-opening it later, after more capabilities depend on today's shape, would not be.

**What this does NOT do:** it does not create a `connections/github-app/` folder, does not add any App-specific code, does not change `EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME`'s single-PAT enforcement, and does not imply the current PAT setup is temporary in the sense of "needs replacing soon" — only that the Owner and any future AI session should recognize the three trigger conditions above as the actual decision points, rather than re-deriving this reasoning from scratch (or worse, reaching for "just add another env var" when a second Account shows up, which P-GH-013 already forbids).

**Explicit non-goal:** this ADR does not evaluate OAuth Apps, GitHub CLI device flow, or SSH-based git access as alternatives — GitHub's own documentation frames the decision as PAT-vs-App for exactly this integration shape (long-lived, acts on behalf of others), so those were not separately researched.

### Sources

[Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) · [Deciding when to build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app) · [Check runs](https://docs.github.com/en/rest/checks/runs) · [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

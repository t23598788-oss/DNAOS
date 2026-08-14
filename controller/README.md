# controller/ — NOT_YET_BUILT

The EMS-style entry gateway. Every external request lands here first.

**Responsibility, and only this:** authenticate the caller → authorize
against `../permissions/boundary.ts` → classify intent against a known,
registered capability (never guess an unknown intent into existence) →
route to exactly one destination adapter in `../connectors/`, within the
caller's own account/tenant scope.

**Explicitly not this module's job:** business logic. If a rule here starts
looking like "how do we compute X for this domain" instead of "who is this
and where does their request go," it belongs in a connector or in
Operational, not here — this mirrors the Owner's explicit instruction that
the outer API layer stays thin.

No controller implementation exists yet. `../contracts/envelope.ts` defines
what it will receive; `../execution/command-lifecycle.ts` defines the
states a request moves through once one exists.

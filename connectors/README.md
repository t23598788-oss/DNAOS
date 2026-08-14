# connectors/ — NOT_YET_BUILT

Destination adapters. One adapter per real backend this system can route
data to — a Supabase adapter, a GitHub adapter, a Vercel adapter, an AI
provider adapter, a future non-Supabase database adapter, etc.

**Responsibility:** given a routed Command, actually perform the real call
against one specific external system, and translate its result back into
an `EventEnvelope` (`../contracts/envelope.ts`). Each adapter owns its own
"how do I talk to this backend" — the controller never knows those
details.

**Credential rule (proven, not theoretical):** an adapter holds a
*reference* to where its credential lives (`registry-schema.ts`'s
`credential_ref: { kind: "env_var", name: string }`), never the credential
value itself. This exact pattern was built and verified in
`dna-os-deadboard`'s TASK-172 (`engines/connectors/tester.ts`'s
`resolveCredentialValue()`, `connectors.config.secret_env_var`) — reused
here, not reinvented.

No adapters exist yet. When the first one is built (most likely candidate:
a Supabase adapter, since that's the only backend with credentials already
available), it should implement whatever adapter interface gets defined
here at that time — not defined yet, since a single real example is worth
more than a guessed interface (Owner's own point 8 caution against
premature generalization applies here too).

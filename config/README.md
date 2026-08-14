# config/ — pattern documented, no loader built yet

Non-secret configuration and credential *references* only — never a raw
token, in code, in a committed file, or in a database row.

**Pattern (proven in `dna-os-deadboard` TASK-172, reused here as policy,
not re-derived):** a config value names an environment variable
(`{ kind: "env_var", name: "SOME_TOKEN_NAME" }`); the real value is read
from `process.env` only at the moment it's needed, by whichever connector
adapter needs it. Rotation = change the env var's value; zero source
changes, by construction. See `../registry/registry-schema.ts`'s
`ConnectionRegistration.credential_ref`.

NOT_YET_BUILT: no actual config loader exists in this repo yet — there is
nothing running here that would read an env var yet.

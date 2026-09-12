# Secret boundary

Existing Write Gate denies secret/env-shaped targets before capability
overlap, including patterns such as:

- `.env` / `.env.*`
- `.npmrc` / `.netrc`
- `*.pem` / `*.key` / `id_rsa*`
- path segments matching `credential` / `secret` (case-insensitive)

Reason code: `SECRET_OR_ENV_PATH_DENIED`.

Credential values themselves must not be stored in Repository Registry
rows (`connection_id` is a reference only — see `software/repository-registry/types.ts`).

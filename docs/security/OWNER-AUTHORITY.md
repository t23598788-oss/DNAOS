# Owner authority

Existing Owner authority surfaces in this repository include:

- Owner Command admission / envelopes (`control/owner-command`)
- Owner authentication sessions (`control/owner-authentication`)
- Shared-secret gate for non-loopback HTTP binds (`permissions/network-auth-gate`)
- Write Gate policy for filesystem/capability writes (`permissions/write-gate`)

Owner authority is **not** conferred by:

- Presence of a Git remote alone
- An old checkout path from another machine
- MCP tool discovery alone
- A deployment provider brand

Write path for CONTROL_PLANE source still requires Write Gate success after
repository resolution.

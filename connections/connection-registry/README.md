# connections/connection-registry/

หน้าที่: the one real, persistent write/read path for
`contracts/connector/connection.ts`'s `ConnectionRegistration` —
REGISTER_CONNECTION, LOOKUP_CONNECTION, UPDATE_CONNECTION_STATUS. Single
owner of that one job; nothing else.

This closes the gap that file's own header used to state explicitly:
"NOT_YET_BUILT: no real connection has been registered."

## Deterministic identity

`buildConnectionId({adapter, connection_type, target})` builds
`connection://<adapter>/<connection_type>/<owner>/<repository>/<branch>`
— no hash, fully inspectable. Re-registering the exact same real target
is idempotent (`registerConnection` returns the existing row,
`inserted: false`), never a duplicate.

## Real git discovery, never a guess

`./git-discovery.ts`'s `discoverGitRemote()` reads the actual local
repository — `git rev-parse --show-toplevel`, `git remote -v`, `git
branch --show-current` — and derives owner/repository/branch from the
real `origin` remote URL (HTTPS or SSH). No default, no fallback value;
any failure (no git repo, no `origin`, a non-GitHub remote, detached
HEAD) is reported as a typed, honest failure, never guessed past.

## Persistence

Append-only JSONL, "latest record per connection_id wins" —
`connections/connection-registry/data/connections.jsonl` — the exact
same convention `credentials/registry/*.ts` already uses elsewhere in
this repo. A restart re-reads this file fresh.

## No raw secret, ever

`ConnectionRegistration.credential_ref` is the only credential-shaped
field here, and it is always a reference (`env_var` name, or now a
`keychain_ref` logical identity string like
`credential://github/<owner>/<repository>/source-authority`) — never a
token value. The real secret lives exclusively in macOS Keychain, via
`credentials/macos-keychain/`.

Input: `RegisterConnectionInput`, `ConnectionLookupQuery`.
Output: `registerConnection`, `lookupConnection`, `listConnections`,
`updateConnectionStatus`, `discoverGitRemote`.
Dependency ที่อนุญาต: `../../contracts/connector/connection.ts`,
node:fs, node:path, node:child_process, node:util.
สิ่งที่ห้ามแตะ: never accept or persist a raw secret value. Never
hardcode an owner/repository/branch anywhere in this folder — always
real, discovered or caller-supplied data.

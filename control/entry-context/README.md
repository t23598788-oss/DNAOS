# control/entry-context/

**หน้าที่:** the single internal Entry Context Resolver — resolves
Identity, Membership, `CommandPolicyDescriptor`, and `ExecutionGrant`
from real stores only, and assembles the `ExecutionPolicyContext`
`../owner-command/`'s `submitOwnerCommand` / `../command-router/`'s
`routeOwnerCommand` need before they may call
`evaluateExecutionPermission`. Sits at the real entrance of the internal
path:

```
Owner Command → entry-context (resolve) → command-router → evaluateExecutionPermission → ALLOW only → execution/run
```

**Status (2026-08-16):** built and tested — internal composition only,
per Owner instruction. **No external system is connected** — nothing
here calls GitHub/Supabase/LINE/Vercel or any network/database.

**Input:** `EntryContextRequest` — plain `identity_id`/`account_id`/
`workspace_id`/`command_id` strings. See `./types.ts`.

**Output:** `EntryContextResolution` — an `ExecutionPolicyContext` ready
to pass as `RouteOptions.executionPolicyContext`, plus a matching
`executionRequestBase`. See `./contract.ts`.

**Dependency ที่อนุญาต:**
`../../permissions/access-control/identity-registry.ts`,
`../../permissions/access-control/membership-registry.ts`,
`../../permissions/execution-policy/contract.ts`,
`../../execution/run/contract.ts` — every one of these is the real,
authoritative source for the concept it resolves; none is duplicated
here.

**สิ่งที่ห้ามแตะ:**
- Never construct an `Identity`/`Membership`/`ExecutionGrant`/
  `CommandPolicyDescriptor` literal here — always read from the real
  store.
- Never call `evaluateExecutionPermission` or `startExecution` from this
  folder — this folder only assembles the context; deciding and
  executing stay in `../command-router/` and `../../execution/run/`.
- Never connect an external system from this folder.

**Files:**
- `types.ts` — `EntryContextRequest`, `EntryContextResolution`.
- `resolver.ts` — `resolveEntryContext()`. Private implementation.
- `contract.ts` — **the only file a caller outside this folder may
  import.**
- `tests/entry-context.test.ts` — real-source composition tests, plus a
  full end-to-end proof through `../owner-command/`'s
  `submitOwnerCommand`.

**Real Account/Workspace resolution note:** this repo has no independent
Account/Workspace registry yet — an account/workspace is only real, for
permission-context purposes, if a real `Membership` row backs it. See
`./resolver.ts`'s own header for the full reasoning and the flagged
`NOT_YET_BUILT` follow-up if an independent registry is ever built.

**NOT_YET_BUILT:** no runtime transport (CLI/HTTP/etc.) calls
`resolveEntryContext()` yet — same gap `../owner-command/README.md`
already documents for `submitOwnerCommand`. No Account/Workspace registry
independent of Membership (see above).

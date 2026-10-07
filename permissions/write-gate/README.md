# permissions/write-gate/ — the deterministic Write Gate

Owner-approved 2026-08-19, built on `../execution-policy/`'s exact
pattern: fixed-order pure rules, every decision fully evidenced, fail-
closed on any internal error.

`evaluateWriteIntent(intent, context)` returns exactly one of Owner's 5
machine-readable outcomes: `ALLOW_CREATE` / `ALLOW_MODIFY` /
`REUSE_EXISTING` / `DENY` / `UNKNOWN`. `UNKNOWN` is fail-closed by
construction — nothing downstream (`execution/file-write/`) ever
proceeds on anything but `ALLOW_CREATE`/`ALLOW_MODIFY`.

Queries `software/capability-registrar/contract.ts`'s real
`CAPABILITY_INDEX` (supplied by the caller as `WriteGateContext`, never
re-scanned by this module) before every `CREATE` — Owner ข้อ 7, literally.

## NOT_YET_BUILT

No runtime caller yet — see `./tests/policy.test.ts`.

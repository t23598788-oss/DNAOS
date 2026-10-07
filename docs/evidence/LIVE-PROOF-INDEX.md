# Live proof index

Each claim cites the **exact command** responsible.

| Claim | Command | Result recorded this closeout |
|---|---|---|
| Write Gate policy (CONTROL_PLANE root, business/surface deny, secrets, stale path, missing checkout) | `npx tsx permissions/write-gate/tests/policy.test.ts` | PASS — ALL CASES PASSED |
| Overlap dedup equivalence + router/agent-gateway import proofs | `npx tsx permissions/write-gate/tests/overlap-dedup-equivalence.test.ts` | PASS — 10 passed, 0 failed |
| Repository Registry discovery/idempotent/suspend | `npx tsx software/repository-registry/tests/repository-registry.test.ts` | PASS A/B/D/E; FAIL C (deadboard checkout missing) |
| Repository census + bridge | `npx tsx software/repository-registry/tests/repository-census-and-bridge.test.ts` | Mixed — identity PASS; fixture count / bridge tally FAIL |
| Full typecheck | `npm run typecheck` | EXIT 2 — 37 errors, **0** under `permissions/write-gate/**` or `software/repository-registry/**` |
| Targeted typecheck filter | `npm run typecheck` then filter paths | No hits in changed packages |

## Source authority for CONTROL_PLANE path

Live checkout used for proofs:

`/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE`

Branch used for commit closeout:

`control/write-gate-control-plane-checkout-v1` (created from previously detached `cf2c92a`)

# Verification matrix

States used here: **VERIFIED** | **FAILED** | **BLOCKED** | **NOT_TESTED**

Never promote NOT_TESTED to VERIFIED without the exact proof command.

| Claim | State | Proof / note |
|---|---|---|
| Write Gate policy CONTROL_PLANE confinement + deny cases | VERIFIED | `npx tsx permissions/write-gate/tests/policy.test.ts` — ALL CASES PASSED |
| Write Gate overlap dedup equivalence | VERIFIED | `npx tsx permissions/write-gate/tests/overlap-dedup-equivalence.test.ts` — 10 passed |
| Repository Registry self-discovery / suspend (on named branch) | VERIFIED | `npx tsx software/repository-registry/tests/repository-registry.test.ts` — A/B/D/E PASS after branch checkout |
| Repository Registry discovers sibling `dna-os-deadboard` checkout | FAILED | Same test case C — `NOT_A_GIT_REPOSITORY` (sibling path absent on this node) |
| Repository census OPERATIONAL identity for INFRASTRUCTURE | VERIFIED | `npx tsx software/repository-registry/tests/repository-census-and-bridge.test.ts` — identity PASS |
| Census TEST_FIXTURE exact historical count | FAILED | Same census test — expected 117, observed 125 (fixture drift; pre-existing data) |
| Canonical resource bridge count “no bindings” | FAILED | Same census test — reported 167/949 bound; historical expectation outdated |
| TypeScript errors in `permissions/write-gate/**` | VERIFIED | `npm run typecheck` — none in changed paths |
| TypeScript errors in `software/repository-registry/**` | VERIFIED | `npm run typecheck` — none in changed paths |
| Full-repo `npm run typecheck` clean | FAILED | 37 pre-existing errors (MCP/Google/agent-physical-scope/etc.); none introduced in this change set |
| `resolveControlPlaneCheckout` live returns ACTIVE CONTROL_PLANE at Desktop path | VERIFIED | Owner-stated live proof + policy tests using operational registry |
| Owner Command `:8791` LaunchAgent live | NOT_TESTED | Not part of this write-authority closeout run |
| DNA OS MCP `:8793` | NOT_TESTED | Explicitly out of scope for this change |
| Complete end-to-end Owner Intent → Git publication | NOT_TESTED | Partial path verified at Write Gate / Registry only |

## Complete verification claim

**Do not claim complete verification.** Several rows remain FAILED / NOT_TESTED.

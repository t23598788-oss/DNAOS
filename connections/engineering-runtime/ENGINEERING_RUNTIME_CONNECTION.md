# DNA OS Engineering Runtime

Canonical document ID: `connection.engineering-runtime.coding-gate.v1`

This is the human/developer projection of the machine-readable semantic record in [connection-document.json](./connection-document.json). The JSON record is the source of truth.

## Authority separation

| Authority | Status | Meaning |
|---|---|---|
| **ENGINEERING_CODING / CODING_WORKER** | VERIFIED | Isolated worktree scoped writes only. COMMIT / PUSH / PR / DEPLOY = DENY. Cannot copy into the registered checkout, commit, or hold a GitHub token. |
| **ADMISSION** | VERIFIED | DNA OS compares original intent, registered repository, reservation, allowed paths/symbols, actual diff, forbidden paths, tests, and hashes. Worker self-report is not trusted. |
| **LOCAL_INTEGRATION** | VERIFIED | After ALLOW, DNA OS copies only admitted paths into the registered repository and records registry/evidence. |
| **DNA_OS_COMMIT** | VERIFIED | DNA OS only. `commit-tree` of admitted paths, parented at the registered default branch. Worker git commit commands are refused. |
| **GITHUB_PUBLISH** | VERIFIED | DNA OS only. Pushes the DNA OS commit to the destination resolved from `repository_id`. No force push. No worker token. Live proof: `3c992c709a99fe8892d7b7093870b877c223ab32` on `t23598788-oss/-DNA-OS-INFRASTRUCTURE-@main`. |
| **OWNER_EVIDENCE_PIPELINE / DISPLAY_QUEUE** | VERIFIED | Runtime actions and agent messages ingest as Canonical Owner Activity Events, bind existing evidence, enqueue the Display Queue, and project compact processing groups. GitHub VERIFIED requires remote SHA read-back. |
| **EXTERNAL_AI_SOURCE_WRITE** | DENIED_BY_ARCHITECTURE | External AI may read permitted knowledge, produce structured Engineering Intent, and submit through DNA OS Tool/Authority. It may not choose repository paths as authority, write source, commit, push, use GitHub write credentials, or deploy. This is an invariant, not a prompt instruction. |
| **DEPLOYMENT** | NOT_WIRED | No Supabase / Vercel / Railway / DigitalOcean production deploy. PR automation remains NOT_WIRED. |

Business Runtime READ / OPERATE / DOCUMENTATION commands have zero source-write authority.

The long-term interface is: External requester/model → DNA OS Tool → DNA OS Authority → registered capability → execution → evidence. The model is a language/intent producer only.

## Completion chain

Owner / External AI → Structured Engineering Intent → DNA OS Engineering Runtime → scoped isolated worktree → code + tests + docs + contract + registry → Engineering Result Manifest → Admission ALLOW → DNA OS Integration → DNA OS Commit Authority → DNA OS GitHub Publish Authority → registered GitHub repository → commit SHA / remote proof → evidence + lineage → VERIFIED (or honest BLOCKED)

A coding work order is not complete because code and tests pass. Local VERIFIED still requires CODE + TESTS + machine-readable contract + human documentation + registry/connection update + evidence. GitHub publication is a separate DNA OS authority after that.

## Live proofs

Isolated coding gate: `npx tsx control/engineering-runtime/tests/engineering-gate.test.ts`

Internal completion: `npx tsx control/engineering-runtime/tests/engineering-completion.test.ts`

Source publication (clean proof checkout): `npx tsx control/engineering-runtime/tests/engineering-github-publish-live.test.ts`

Live remote status is **VERIFIED**. Authenticated GitHub identity `t23598788-oss` published DNA OS commit `3c992c709a99fe8892d7b7093870b877c223ab32` to registered `main`; GitHub remote SHA read-back matched. The Owner Surface activity group shows GitHub icon, "Commit accepted", SHA_MATCH=true, details behind `details_reference`. Direct Contents/worker writes remain denied. Unrelated files in the authoritative checkout were not stashed, reset, or discarded.

## Remaining NOT_WIRED

- Pull Request creation
- production deploy (Supabase / Vercel / Railway / DigitalOcean)
- `continueRegisteredArtifact` (Contents write for this registered repository is closed: `DNA_OS_PUBLISH_AUTHORITY_REQUIRED`)

# control/source-execution/

หน้าที่: Source Execution — the layer after Admission, for
`SOURCE_REFERENCE` artifacts only:

```
ADMITTED SOURCE -> EXECUTION DISPATCH -> GITHUB SOURCE EXECUTOR
  -> WRITE/COMMIT/PUSH -> EXECUTION RESULT -> EVIDENCE/VERSION REFERENCE
  -> RETURN TO DNA OS -> STOP
```

Answers exactly one question: given a real `ADMITTED` Admission result,
perform the one authorized GitHub write it was admitted for, and nothing
else. `./resolver.ts`'s `executeSource()` is the single owner of "did the
write actually happen."

## The Agent never touches GitHub

The Agent supplies file content (via the existing DNA OS MCP —
`submit_work_result`/whatever future execution-dispatch tool wraps this)
and never a credential, never a commit, never a push. DNA OS itself is
the only caller of `executeSource()`, and the only caller of
`connections/github/write-api.ts`'s real GitHub write. Credentials are
resolved exclusively through `connections/github/credential-resolution.ts`
— the same env-var-by-reference boundary every other GitHub read already
uses; this folder never reads an env var itself.

## Reuses `connections/github/`, adds exactly one write call

No new Git client. `connections/github/write-api.ts` (new this round,
explicitly authorized — see its own header) is the ONE new write
function, built on the SAME `host-runtime.ts`/`credential-resolution.ts`/
`repo-path.ts`/`adapter-config.ts` this folder already had — `hostFetch`
itself stays untouched and provably GET-only; a separate `hostFetchWrite`
(PUT-only) was added instead. `checkRepoPath` (source path validation),
`resolveGithubCredential`, and `getRepository` (repository existence) are
all reused unmodified.

## Never re-runs a prior stage

Never calls `classifyCandidate`, `resolveDuplicate`,
`resolveArtifactDestination`, `resolveTarget`, or `resolvePolicy`. The
real, persisted `AdmissionResult` (the same Evidence row
`control/admission/resolver.ts` itself wrote, `kind: "admission"`) is
independently re-read and cross-checked against the caller's claim —
never trusted on its own.

## Pre-execute checks

1. A prior execution for this exact `admission_id` exists -> replay it
   as-is, GitHub is never called twice (idempotency, requirement L — a
   new commit requires a genuinely new Admission, never a bare retry).
2. The real, persisted Admission exists.
3. `artifact_resource_id`/`task_id` match the Admission's.
4. Admission's `decision === "ADMITTED"` with a real `execution_ready_reference`.
5. `resolved_target.target_ref` matches Admission's.
6. `authorized_action === "WRITE_SOURCE"` — anything else is
   `EXECUTION_NOT_SUPPORTED`, stop.
7. The artifact/task are still real and findable.
8. `source_location` passes the real, reused `checkRepoPath`.
9. A real, `connected` GitHub connection was supplied — never fabricated.
10. A real credential resolves through the existing credential boundary.
11. The repository is verified live against GitHub — `getRepository`.

Only after every check passes does `connections/github/write-api.ts`'s
`putFileContents` run — create-or-update one file, one commit, on the
already-registered branch, returning the real commit SHA.

## Result

`ExecutionStatus` is exactly `SUCCEEDED | FAILED | UNRESOLVED`.
`UNRESOLVED` means a real prerequisite (connection/credential/repository)
genuinely does not exist yet — never guessed, never fabricated, and this
folder never creates one to fill the gap. Every result persists as
`Evidence` (`kind: "execution_output"`, a literal `Evidence.kind` already
carries) through the agent-gateway's existing evidence store —
restart-surviving, retrievable via `loadEvidenceForTask()`.

On `SUCCEEDED`, the commit SHA is recorded back onto the artifact's own
resource through the EXISTING `control/registration-update/` path
(`ADD_EVIDENCE`, `capability_id: ""` — SOURCE_REFERENCE artifacts are
resource-only rows) — never a new capability, never a new resource, for
a new commit.

Input: `SourceExecutionInput`, a real `RegistryStore`.
Output: `executeSource` -> `SourceExecutionResult`.
Dependency ที่อนุญาต: `../agent-gateway/contract.ts`,
`../../software/registry-database/contract.ts` (`findResourceById` only),
`../registration-update/contract.ts` (`applyMutation` only),
`../../connections/github/repo-path.ts`,
`../../connections/github/credential-resolution.ts`,
`../../connections/github/github-read-api.ts` (`getRepository` only),
`../../connections/github/write-api.ts` (`putFileContents` only),
`./types.ts`, `./host-runtime.ts`.
สิ่งที่ห้ามแตะ: never call classification/duplicate/destination/target/
policy functions. Never call `runRegistrationPipeline`/
`commitRegisteredCandidate` for a commit. Never hardcode an
owner/repo/branch/token — every one of those is caller-supplied,
already-registered data. No Pull Request, branch protection, review,
release, GitHub Actions trigger, deploy, or Vercel call anywhere in this
folder.

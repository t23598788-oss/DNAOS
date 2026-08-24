# CANONICAL_MAP — Phase 4 Reconciliation (2026-08-24)

Owner-approved canonical composition by verified primitive. Format:
`old component -> canonical component -> retained evidence -> retired component`.

## 1. Confinement contract

- **Old (Track A)**: `./policy.ts#SandboxPolicy` (+ `FilesystemPolicy`/`NetworkPolicy`/`ProcessPolicy`/`PtyPolicy`)
- **Canonical**: `./types.ts#ConfinementSpec` (+ `NetworkPolicy`, `PtySessionRequest`/`PtySessionResult`)
- **Retained evidence**: none of Track A's own tests exercised `SandboxPolicy` adversarially — no evidence lost by its retirement.
- **Retired**: `./policy.ts` deleted outright (not just unexported) — Owner hard rule: no second confinement authority model.

## 2. Seatbelt renderer

- **Old (Track A)**: `./policy.ts#buildPolicyDrivenSandboxProfile` — no path escaping, no symlink resolution.
- **Canonical**: `./seatbelt.ts#buildSeatbeltProfile`
- **Retained evidence**: `./tests/adversarial-seatbelt.test.ts` — 14/14, real kernel, including the SBPL-injection exploit (case E1) and its fix (case E2/E3/E4).
- **Retired**: `buildPolicyDrivenSandboxProfile` deleted with `policy.ts`.
- Note: `control/agent-host/host-runtime.ts#buildSandboxProfile` is a SEPARATE, pre-existing, narrower renderer (single-workspace/single-executable, for AI Agent Host launches only) — not a duplicate of the general-purpose canonical renderer here; it was independently patched this round with the equivalent escaping+realpath fix (see §4) because it serves a genuinely different caller (`launchAgent`, for AI runtimes) than `requestProcessExecution` (for internal DNA-OS executables). This mirrors the pre-existing, Owner-accepted split between `control/agent-host/` and `execution/run/` as two intentionally separate launch paths for two different caller classes.

## 3. PTY implementation

- **Old**: none (Track A had no PTY).
- **Canonical**: `./pty.ts#runPtySession` + `./pty-helper.py`
- **Retained evidence**: `./tests/pty-stream.test.ts` — 4/4, real kernel (`forkpty`, live streaming, confinement-under-PTY, timeout kill).
- **Retired**: nothing (no competing implementation existed).

## 4. Process-Gate-facing launch orchestration

- **Old (Track A)**: `./adapter.ts#launchViaRuntimeAdapter` — built its own SBPL text via `buildPolicyDrivenSandboxProfile` and called `child_process.spawn` directly (a second raw spawn site within this capability).
- **Canonical**: `./adapter.ts#launchViaRuntimeAdapter`, REFACTORED to consume `ConfinementSpec`, render via `./seatbelt.ts#buildSeatbeltProfile`, and launch via `./host-runtime.ts#spawnConfined` — the exact same spawn primitive `./pty.ts` already uses. Zero raw `child_process` calls remain in `adapter.ts`.
- **Retained evidence**: `execution/run/tests/process-boundary-scan.test.ts` before/after — 12 violations (2 from the old `adapter.ts` raw spawn, 2 from `host-runtime.ts`, 8 pre-existing/out-of-scope) down to 8 (all pre-existing/out-of-scope) after the refactor.
- **Retired**: `adapter.ts`'s own `child_process.spawn` call and its own SBPL-writing/hashing logic (replaced by calls into `./seatbelt.ts`/`./host-runtime.ts`).

## 5. SBPL injection security patch (elevated ahead of reconciliation)

- **Target**: `control/agent-host/host-runtime.ts#buildSandboxProfile` (a DIFFERENT file from this capability — see §2 note).
- **Vulnerability**: raw, unescaped `${path}` interpolation; a sibling-directory NAME containing SBPL syntax (paren-balanced payload) injected an `(allow network*)` directive. Kernel-verified: a spawned child successfully reached `1.1.1.1:80` under the exploited profile.
- **Fix**: independently re-derived (not imported — that file's own contract forbids cross-folder imports) `escapeSbplPath`/`resolveRealPath`, same technique as `./seatbelt.ts#escapeSbplString`/`requireAbsolute`.
- **Regression coverage (permanent)**: the exact exploit payload (`")) (allow network*) (allow file-read* (subpath "`) is now covered live in `./tests/full-chain-adversarial.test.ts`'s `SBPL_PATH_INJECTION` case, which routes the identical payload through the FULL reconciled chain (Process Gate -> Runtime Adapter -> Seatbelt -> kernel), not just the isolated `host-runtime.ts` patch test used during promotion.
- **Status**: promoted, kernel-verified both directions (attack denied, normal path unaffected), zero regression on `control/agent-host/tests/proof.test.ts` (2/2) and `real-agent-launch.test.ts` (15/15).

## Process-boundary classification (step F)

| File | Classification |
|---|---|
| `control/runtime-adapter/host-runtime.ts` | **CANONICAL_BOUNDARY** — the one spawn site for this capability (adapter.ts + pty.ts both reach it); added to `CANONICAL_BOUNDARY_FILES`. |
| `connections/agent-registry/claude-assignment-adapter.ts`, `codex-assignment-adapter.ts`, `codex-heartbeat-adapter.ts` | **LEGACY_BYPASS** — pre-existing, disclosed since the "Single Process Creation Gate" phase, out of Phase 4's scope. Not allowlisted; not fixed here. |
| `connections/os-login/adapter-contract.ts`, `connections/os-ui/adapter-contract.ts` (×5) | **LEGACY_BYPASS** — same, pre-existing, out of scope. |

No `UNMEDIATED_PROCESS` or `DUPLICATE_PATH` classification remains after the `adapter.ts` refactor — its own duplicate spawn (a real, disclosed `DUPLICATE_PATH` at reconciliation time) is retired per §4.

## Phase 4.1 update (2026-08-24) — supersedes `capability-91ea15d0-eaf9-4629-93b9-ecbd681c6f42`

Discovery step: queried both reachable peer sessions (`dna-os-infrastructure-74`, `dna-os-infrastructure-a1`) before changing anything. `a1` ruled itself out (unrelated repo/work). `-74` (Track B's original author) disclosed, with reproduction steps, that: the nested-`.git` gap was real and unfixed; `FILE_READ_DEFAULT_DENY` had no new attempt beyond the documented negative result; `LOOPBACK_PORTS` was shipped with zero test coverage and should not be trusted; the `connections/*` legacy bypasses were never investigated. All four claims were independently reproduced before acting on them.

- **Nested `.git` protection (primitive 4)**: `./seatbelt.ts`'s `MANDATORY_WRITE_DENY_RELATIVE` (per-root literal join) replaced with `MANDATORY_GIT_CONFIG_WRITE_DENY_REGEX`/`MANDATORY_GIT_HOOKS_WRITE_DENY_REGEX` (regex denies, code-owned constants, never caller input) — matches `.git/config`/`.git/hooks` at any depth, including a repo a candidate script creates during its own run. Kernel-verified: root denied, nested denied, legitimate write unaffected. `adversarial-seatbelt.test.ts` case F rewritten from "asserts the known gap" to "asserts the fix"; case F3 added for `.git/hooks`. `full-chain-adversarial.test.ts`'s old `NESTED_GIT_MUTATION` case (which only ever tested the ROOT path — a real evidence overclaim flagged by `-74`) renamed to `ROOT_GIT_MUTATION`; a genuinely nested case added under the same name.
- **`FILE_READ_DEFAULT_DENY` (primitive 5)**: re-attempted independently (allowlist `/usr`, `/System`, `/Library`, dyld-cache paths, deny everything else for read) — same `SIGABRT` as the two prior documented attempts, no new diagnostic signal available (unified log sandbox-denial entries require elevated access this session doesn't have). Remains genuinely `UNRESOLVED` — not converted to PASS.
- **`NETWORK_SELECTIVE_EGRESS` (primitive 6)**: `LOOPBACK_PORTS` kernel-tested for the first time (`adversarial-seatbelt.test.ts` case J) — an allowed port connects, a non-allowlisted loopback port and a remote host both fail closed (`EPERM`). The mechanism is now verified; no proxy/consumer exists yet and no registry entry uses it — `DENY_ALL` remains what every real launch actually gets.
- **Legacy bypasses (primitive 7)**: investigated, not migrated. `claude-assignment-adapter.ts`/`codex-assignment-adapter.ts`/`codex-heartbeat-adapter.ts` need `--resume <session_id>` support Agent Host's `worker-registry.ts`/argv-builder does not have yet. `os-login/adapter-contract.ts` (Tailscale status) and `os-ui/adapter-contract.ts` (`open`/`osascript`/`caffeinate`/`screencapture`) drive real GUI/TCC-gated OS automation — the same class of finding as the Keychain/`sandbox-exec` ACL incompatibility (wrapping would very likely break the OS's own per-binary TCC grant) — the correct migration is a `confinement: "direct"` registry entry per binary (same pattern as Keychain), not forcing them through `"sandboxed"`/`"policy"`. Neither migration attempted this round; `DIRECT_UNGATED_PROCESS_CREATION_COUNT` remains 8, reported honestly as `PARTIAL`, not silently allowlisted.

Registered: `capability-dd59e9af-766d-4acb-9e6a-eba12683cb6f` / `resource-a7d25eb3-8ef6-403c-bb7c-5e46444f2c9f`.

# control/runtime-adapter — TRACK B STATUS (2026-08-24)

> Written as a separate file, NOT merged into `./README.md`, because that
> file belongs to a concurrent session still working in this folder. Do
> not merge the two without reading the RECONCILIATION section below.

## Why there are two tracks

This folder was built **concurrently by two sessions running the same
Phase 4 plan**, neither aware of the other:

| | Track A | Track B |
|---|---|---|
| Files | `policy.ts`, `adapter.ts`, `README.md` | `types.ts`, `seatbelt.ts`, `host-runtime.ts`, `pty.ts`, `pty-helper.py`, `UPSTREAM_REVIEW.md`, `tests/` |
| Profile input shape | `SandboxPolicy` (policy object) | `ConfinementSpec` (spec object) |
| Launch | `launchViaRuntimeAdapter` | `runPtySession` |
| Wired into repo | yes — `execution/run/process-gate.ts`, `process-registry.ts` | **no** |
| Adversarial proof | none present | `tests/adversarial-seatbelt.test.ts`, 14/14 vs real kernel |

Both pinned the SAME upstream commits independently, which is a useful
cross-check: `sandbox-runtime@bcad3881`, `node-pty@56c6ac3b`.

**Incident, disclosed:** Track B overwrote Track A's `contract.ts` before
the collision was noticed. `contract.ts` has been rebuilt to re-export
both tracks; Track A's exports (`launchViaRuntimeAdapter`, `SandboxPolicy`,
…) are restored and `npx tsc --noEmit` is clean repo-wide. Track A's
original `contract.ts` prose was not recoverable (the folder is untracked
in git), so its header was rewritten rather than restored verbatim.

## RECONCILIATION REQUIRED (Owner decision)

`policy.ts#buildPolicyDrivenSandboxProfile` and
`seatbelt.ts#buildSeatbeltProfile` **both generate Seatbelt profiles from
different input types.** That is a duplicate mechanism inside one
capability folder and violates the repo's own Duplicate Gate discipline.
It must be collapsed to one before this folder is called done.

Recommendation, on evidence rather than authorship: keep Track A's
`SandboxPolicy` as the public input shape (the repo already depends on
it), and reimplement its renderer on top of Track B's `seatbelt.ts`,
which carries three fixes Track A's renderer does not have — see below.

## What Track B proved, and fixed

All findings below are from real `sandbox-exec` runs on this host
(macOS 26.6.2 / Darwin 25.6.0), not from reading profile text.

### 1. SBPL injection — CONFIRMED EXPLOITABLE, fixed here

`control/agent-host/host-runtime.ts#buildSandboxProfile` interpolates
caller-supplied paths into SBPL with raw `"${path}"` and no escaping. A
directory named:

```
ws")) (allow network*) (allow file-write* (subpath "/tmp/decoy
```

produces a **valid** profile containing `(allow network*)`. Reproduced:
the child got full TCP egress its caller never granted
(`tests/adversarial-seatbelt.test.ts` case E1, which asserts the defect
is real). Case E2 proves the same payload through `seatbelt.ts` grants
nothing.

Reachability — latent but real, three paths:
- `execution/run/process-gate.ts:118` guards `cwd` with `startsWith`,
  which an injected **suffix** passes trivially.
- `control/agent-gateway/agent-host-dispatch.ts:337` feeds real on-disk
  sibling **directory names** into `outsideProbeDirs`.
- `workspace-manager.ts` derives its path from a caller-supplied
  `workspace_root`.

No evidence of exploitation; the ingredient is control of one path
component. **`agent-host` is NOT fixed — only this folder is.** See
WIRING STATUS.

### 2. Symlink resolution — silent misconfinement, fixed here

Seatbelt matches the kernel's **resolved** path. `os.tmpdir()` returns
`/var/folders/...`, a symlink to `/private/var/folders/...`, so a
`(subpath "/var/...")` rule matches nothing and the workspace the caller
asked to be writable silently is not. Caught by case B2 failing.
`host-runtime.ts#realPath` resolves the longest existing ancestor.
Upstream has this as `normalizePathForSandbox()`; Track A's `policy.ts`
does not appear to.

### 3. `(allow pseudo-tty)` grants nothing

Accepted by the parser, **no effect** on `os.forkpty()`. The real minimal
set, found by bisection, is `(allow file-ioctl)` plus write on
`/dev/ptmx` and `/dev/ttys*`. `seatbelt.ts` deliberately does not emit
`pseudo-tty`, because a rule that grants nothing misrepresents the
profile. Track A's `PtyPolicy` should be checked against this.

### 4. Corrections to the Phase 3 report

- **"Network isolation: MISSING" was wrong.** Under `(deny default)`,
  egress is already kernel-denied — verified, `EPERM` on a raw TCP
  connect (case A). What is missing is *selective allowlisting*, not
  isolation. `NetworkPolicy.DENY_ALL` names the existing behaviour;
  `LOOPBACK_PORTS` is the seam for a future proxy.
- **The donor does not fix default-deny read.** Phase 3 implied
  `sandbox-runtime` would close DNA OS's `(allow file-read*)` gap. At the
  pinned commit it makes the *same* choice: broad read allow, then denies,
  then carve-outs. That gap is therefore **still open** and nothing here
  claims otherwise.

### 5. `/usr/bin/python3` is a stub

It re-execs through the CLT symlink into
`Python3.framework/.../Python.app/Contents/MacOS/Python`. Allowing only
the stub fails with `Operation not permitted`. Handled by granting the
framework tree as a scoped `execAllowSubpaths` entry — a real, disclosed
widening.

## Known gaps in Track B (not fixed, not hidden)

- **Nested repos are unprotected.** The mandatory `.git/config` /
  `.git/hooks` write-deny is emitted per `allowWritePaths` **root** only.
  A repo at `<root>/repo/.git/config` is still writable — asserted
  explicitly as a known gap in case F, not papered over.
- **PTY is output-only**: no stdin channel, so it cannot drive an
  interactive REPL; no resize/`TIOCSWINSZ`; stdout and stderr are merged
  (as a real terminal does).
- **No egress filtering proxy.** `LOOPBACK_PORTS` opens loopback ports
  only; nothing yet listens on them or enforces a domain allowlist.
- **Read confinement is targeted-deny, not default-deny** (see 4 above).
- The `/dev/ttys*` grant is a regex over all pty slaves, not this
  session's specific one — Seatbelt cannot express the latter before the
  device is allocated.

## WIRING STATUS — deliberately not done

Phase 4 steps 8 and 9 were **NOT executed**, and this is a scope
decision, not an omission:

- **Step 8 (verify through Process Gate)** and **step 9 (register
  capabilities)** both require editing
  `execution/run/process-registry.ts` and
  `control/command-router/capability-registry.ts` — files the concurrent
  session is **actively editing right now**. Editing them from here would
  repeat the `contract.ts` clobber on files that are tracked and shared.
- `control/agent-host/host-runtime.ts` is **not** switched over to
  `seatbelt.ts`. The injection defect in finding 1 is therefore still
  live in the real launch path. Fixing it is a one-line-per-rule change
  (route `buildSandboxProfile` through `escapeSbplString` + `realPath`)
  but it changes an audited security boundary and belongs in its own
  reviewed step.

## Verification actually run

```
npx tsc --noEmit                                                   # clean, repo-wide
npx tsx control/runtime-adapter/tests/adversarial-seatbelt.test.ts  # 14 passed, 0 failed
npx tsx control/runtime-adapter/tests/pty-stream.test.ts            # 4 passed, 0 failed
```

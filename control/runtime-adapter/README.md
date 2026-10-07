# control/runtime-adapter

Phase 4 — Runtime Primitive Boundary (Owner).

## License review (2026-08-24)

This folder is an **independent, from-scratch reimplementation** of the
*approach* studied in two external projects — no code, file, or
substantial fragment from either is copied, vendored, or imported here.

| Project | License | Pinned commit (HEAD, 2026-08-24) |
|---|---|---|
| `anthropic-experimental/sandbox-runtime` | Apache-2.0 | `bcad38810efcc2b7342bbc6ec26d15b7bbbabcfb` |
| `microsoft/node-pty` | MIT (three stacked MIT blocks: Christopher Jeffrey 2012-2015, Daniel Imms 2016, Microsoft 2018-present) | `56c6ac3b8abd523f09749a0ade9c69cd35e7d514` |

Both licenses are permissive with no copyleft; an independently-written
reimplementation of the *approach* (Seatbelt profile shape, PTY contract
shape) carries no obligation to adopt either license or disclose source.
Apache-2.0 carries an express patent grant (§3, terminates on patent
litigation against the software) — noted, not triggered by this folder
(no code copied). MIT's attribution requirement attaches only to actual
copies of their code, not to an independent implementation.

## What this folder is / is not

- **Is**: the ONE place DNA OS's own `SandboxPolicy`/`FilesystemPolicy`/
  `NetworkPolicy`/`ProcessPolicy`/`PtyPolicy` contracts live, and the ONE
  additional, deliberate, documented process-launch boundary
  (`adapter.ts`) that turns a policy object into a real macOS
  `sandbox-exec` profile + spawn — reusing the exact same baseline
  Seatbelt allows (`mach-lookup`/`sysctl-read`/`signal`/`ipc-posix-shm`/
  `file-read-metadata`/broad `file-read*`) that
  `control/agent-host/host-runtime.ts` already established and this repo
  has already empirically proven necessary just to bootstrap any process
  under modern macOS — never re-derived from scratch, never copied from
  either external project.
- **Is NOT** an Agent executor, a second Process Gate, or an authority
  of its own. `execution/run/process-gate.ts` is still the ONE public
  entry any internal DNA-OS component calls through; this folder is
  reached ONLY from `process-gate.ts`, for `ProcessDescriptor` entries
  that declare `confinement: "policy"` (today: `candidate.node.npm.build`/
  `candidate.node.npm.test`, see `execution/run/process-registry.ts`).
  DNA OS policy -> runtime-adapter -> primitive, never the reverse — no
  function in this folder ever decides PASS/FAIL/PROMOTE; it only
  reports raw `exit_code`/`stdout`/`stderr`/`timed_out` back to its
  caller, exactly like every other Process Gate confinement branch.

## Real finding this phase fixed (not a workaround, an actual bug)

Phase 3.5 found `npm run <script>` crashing under the existing sandbox
with `Cannot read properties of undefined (reading 'stdin')`. Root cause
(confirmed via a raw, minimal `sandbox-exec` repro, independent of any
DNA OS code): the previous profile's `process-exec` allowlist named only
one literal executable, but `npm run-script` itself spawns a REAL shell
(`/bin/sh`, which macOS's own `/bin/sh` further re-execs as `/bin/bash`
internally as a "variant") to run the declared script command — that
second (and third) process identity was denied, and npm's own
`@npmcli/promise-spawn`-style error path (when the child process's spawn
itself errors) dereferences an undefined child object, producing the
misleading stdin message.

A SECOND, independent real finding surfaced once `/bin/sh`+`/bin/bash`
were allowed: the shell's own `>` redirection resolves the workspace
path's REALPATH (`/private/tmp/...`) rather than the path as given
(`/tmp/...`, since `/tmp` is a symlink on macOS) — a `file-write*
(subpath "/tmp/...")` rule alone does not cover a write whose underlying
`open(2)` syscall is issued against `/private/tmp/...`. `FilesystemPolicy`
here always includes BOTH the given path and its `realpathSync` form for
every writable path, for exactly this reason — not a widened permission
(the real, physical directory is identical), just a corrected
path-representation gap.

## Honest gap (MISSING, not fabricated)

`PtyPolicy` is defined (the real contract shape node-pty's model
inspired) but **no code path in this repo sets `pty.enabled: true`**.
Real `node-pty` is a native addon requiring a compiled binary
(node-gyp); vendoring/compiling a new native dependency is a real,
separate decision this phase does not make unilaterally — reported as
MISSING, not stubbed as a fake PASS.

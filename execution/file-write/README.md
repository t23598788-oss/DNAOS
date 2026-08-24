# execution/file-write/ — file-write execution, separate from execution/run/

Owner-approved 2026-08-19. Executes real CREATE/MODIFY of a `target_type:
"FILE"` `WriteIntent` — never a shell command (that stays
`execution/run/`'s job), never anything without a real, matching,
ALLOW_* `WriteGateDecision` from `permissions/write-gate/`.

`./contract.ts` exports exactly one write-capable function,
`executeFileWrite` — no other export in this whole capability can reach
the real filesystem write.

## Enforcement status — read before claiming anything

This module closes the path that goes THROUGH it. It does **not**, and
structurally **cannot**, stop a coding agent (Claude Code, Codex, etc.)
with direct filesystem tool access from writing anywhere in this repo
completely outside this call chain. `./tests/bypass-detection.test.ts`
proves that gap is still real in this exact checkout. Per Owner
instruction (2026-08-19): **status is `BYPASS_STILL_EXISTS`, never
`ENFORCED`/`PROTECTED`, until that gap is independently proven closed.**

## NOT_YET_BUILT

No runtime transport wires a real external AI request through
`control/ai-write-control/` → `permissions/write-gate/` →
`execution/file-write/` yet — see `./tests/`, which drives the whole
chain by hand.

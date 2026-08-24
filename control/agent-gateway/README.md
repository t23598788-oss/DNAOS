# Agent Gateway

The Agent Gateway is the single dispatcher-to-worker control plane. Use the
public surface in `contract.ts`; do not call private gateway/store internals
from Owner UI or another repository.

Flow: `submit/dispatch -> ROUTING -> POLICY_CHECK -> Owner decision or
EXECUTING -> VERIFYING -> COMPLETED/FAILED/BLOCKED`.

`controller.ts` serializes dispatcher submissions. `supervisor.ts` starts the
controller, performs restart recovery, and runs the existing 30-second health
sweep. Accepted tasks, evidence, and structured handoffs are append-only
JSONL records under `control/agent-gateway/data/`.

The gateway is not a credential vault and is not allowed to autofill or
bypass macOS security prompts. See `../../credentials/macos-keychain/`.

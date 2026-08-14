# agents/ — NOT_YET_BUILT

Identity/execution scope specific to AI agents connecting as external
Accounts — the original trigger for this whole repo ("โปรแกรมต่าง ๆ / AI
ต่างค่าย → เชื่อมเข้ากับ DNA OS Integration Controller").

**Responsibility:** register what a given AI agent is allowed to do once
it holds an Identity under some Account (`../contracts/identity-model.ts`),
distinct from a generic `external_program` Identity in that agents may
need capability negotiation (which tools/intents they can invoke) rather
than just a fixed permission set.

Nothing here yet — no real AI-agent connection has been built to design
against. `IdentityKind = "ai_agent"` already exists in
`../contracts/identity-model.ts` so the axis is reserved, not invented
fresh later.

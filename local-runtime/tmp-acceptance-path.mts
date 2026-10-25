import { buildChatResult } from "@/app/api/chat/_lib/resultContract";
import type { LayerTrace } from "@/app/api/chat/_lib/resultContract";
import { translateLocalAiCommand } from "@/app/api/chat/_lib/localAiBridge";

const MESSAGE = "ขอดูยอดหนี้ของบริษัท ช.ทวัฒชัยการช่าง";

const outcome = await translateLocalAiCommand(
  MESSAGE,
  { ownerId: "acceptance-probe", sessionId: "acceptance-probe" },
  { emitEvidence: async () => {}, reportFailure: async () => {} },
);
console.log("AI layer:", outcome.status, JSON.stringify(outcome.command), "| provider:", outcome.provenance?.provider);
if (!outcome.command) process.exit(1);

// finance_summary simulation (deterministic layer's incomplete structured intent)
const base = new Request("http://127.0.0.1:3000/api/chat", { headers: { cookie: "none" } });
const trace: LayerTrace = {};
const result = await buildChatResult(base, MESSAGE, {}, outcome.command, trace);
console.log("RESULT:", JSON.stringify(result, null, 1).slice(0, 900));
console.log("LAYERS:", JSON.stringify(trace, null, 1).slice(0, 1400));

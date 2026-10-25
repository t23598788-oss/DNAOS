/**
 * Command Return Routing test (Phase 7) — OFFLINE. No DB, no network.
 */
import assert from "node:assert/strict";
import { routeCommandResult, resolveReplyTarget, type CommandReturnDeps, type CommandRouting } from "@/engines/jobs/command-return";

let pass = 0, fail = 0;
function check(n: string, c: boolean, d = "") { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? " — " + d : ""}`); } }

async function main() {
  check("resolveReplyTarget: known reply_to", resolveReplyTarget({ reply_to: "U123", source_channel: "line" })?.replyTo === "U123");
  check("resolveReplyTarget: no reply_to → null", resolveReplyTarget({}) === null);

  const sent: string[] = [];
  const deliver: CommandReturnDeps["deliver"] = async ({ replyTo, resultKey }) => {
    if (sent.includes(resultKey)) return { status: "SKIPPED_DUPLICATE" };
    sent.push(resultKey);
    return { status: "SENT", messageId: `msg-${sent.length}` };
  };

  // 1. known requester → delivered
  const r1 = await routeCommandResult({ deliver }, { routing: { reply_to: "U123", source_channel: "line" }, result: { ok: true, doc: "d1" }, resultKey: "rk-1" });
  check("known requester → DELIVERED", r1.ok && r1.code === "DELIVERED" && r1.messageId === "msg-1");

  // 2. unknown requester → ROUTING_BLOCKED (result retained, never guessed)
  const r2 = await routeCommandResult({ deliver }, { routing: {}, result: { ok: true }, resultKey: "rk-2" });
  check("unknown requester → ROUTING_BLOCKED", r2.ok === false && r2.code === "ROUTING_BLOCKED");

  // 3. no deliver gateway → ROUTING_BLOCKED
  const r3 = await routeCommandResult({}, { routing: { reply_to: "U123" }, result: {}, resultKey: "rk-3" });
  check("no gateway → ROUTING_BLOCKED", r3.ok === false && r3.code === "ROUTING_BLOCKED");

  // 4. duplicate resultKey → SKIPPED_DUPLICATE (no second send)
  const r4 = await routeCommandResult({ deliver }, { routing: { reply_to: "U123" }, result: {}, resultKey: "rk-1" });
  check("duplicate resultKey → not re-sent", r4.ok === false && r4.code === "DELIVERY_FAILED" && sent.length === 1);

  console.log(`\ncommand-return: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });

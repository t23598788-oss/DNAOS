import assert from "node:assert/strict";
import { normalizeLineEvents } from "../supabase/functions/_shared/core-event-transport.ts";

async function main() {
  const events = await normalizeLineEvents({
    destination: "bot-id",
    events: [{
      type: "message",
      webhookEventId: "line-event-1",
      timestamp: Date.now(),
      replyToken: "must-not-cross-queue",
      source: { type: "user", userId: "line-user-7", groupId: "group-1" },
      message: { type: "text", id: "line-message-1", text: "hello", extra: "must-not-cross-queue" },
    }],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].source, "line");
  assert.equal(events[0].event_type, "message.received");
  assert.equal(events[0].data.capability_id, "conversation.answer");
  assert.equal((events[0].data.line_event as { source: { userId: string } }).source.userId, "line-user-7");
  const serialized = JSON.stringify(events[0]);
  assert.equal(serialized.includes("must-not-cross-queue"), false);
  assert.equal(serialized.includes('"text":"hello"'), true);

  console.log("Core event transport checks passed: LINE text maps to the reply capability and replyToken/unrelated fields are removed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

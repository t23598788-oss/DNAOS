import assert from "node:assert/strict";
import {
  completeTrace,
  getTrace,
  startTrace,
  withExecutionContext,
} from "@/core/runtime/trace";
import { dispatch } from "@/engines/validation/dispatcher";

async function main() {
  const traceId = "chat-execution-trace-offline-test";
  const streamedEvents: string[] = [];
  startTrace(traceId, "[redacted]");

  const result = await withExecutionContext(
    {
      traceId,
      actorId: "test-actor",
      scopeMode: "none",
      organizationIds: [],
      onEvent: (event) => streamedEvents.push(event.event),
    },
    () => dispatch("document.list"),
  );

  assert.equal(result.ok, false, "a tenant-scoped reader without scope must be denied");
  assert.deepEqual(streamedEvents, ["tool.selected"], "denied reads must not report reader execution");
  assert.deepEqual(
    getTrace(traceId)?.events.map(({ event, status }) => [event, status]),
    [["tool.selected", "denied"]],
  );
  assert.equal(getTrace(traceId)?.events[0].actorId, "test-actor");
  assert.equal(getTrace(traceId)?.events[0].scopeMode, "none");

  completeTrace(traceId, "failed");
  assert.equal(getTrace(traceId)?.status, "failed");
  console.log("PASS chat execution trace fail-closed scope contract");
}

void main();

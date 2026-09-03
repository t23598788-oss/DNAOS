import { strict as assert } from "node:assert";
import { projectOwnerDisplayPayload } from "./display-payload";

for (const result of [
  { result_type: "runtime", subject: "CORE", status: "RUNNING", health: "OK", evidence_refs: ["ev-1"], raw_result: { secret: "no" } },
  { result_type: "capability", subject: "AGENT_RESOURCE", status: "UNAVAILABLE", assignable: 0, reason: "NO_SAFE_ASSIGNABLE_AGENT", evidence_available: true },
  { result_type: "agent", subject: "AGENT", state: "FAILED", blocker: "ENOENT", evidence_id: "ev-2" },
  { result_type: "git", subject: "WORKSPACE", status: "OBSERVED", branch: "main", revision: "abc" },
  { result_type: "test", subject: "TESTS", status: "PASS", test_count: 3 },
  { result_type: "error", subject: "CORE", status: "FAILED", reason: "blocked" },
]) {
  const before = JSON.stringify(result);
  const payload = projectOwnerDisplayPayload(result);
  assert.equal(JSON.stringify(result), before);
  assert.equal("raw_result" in payload, false);
  assert.equal("evidence_refs" in payload, false);
}

const unknown = projectOwnerDisplayPayload({ result_type: "future", raw_result: { should_not_escape: true }, logs: ["secret"] });
assert.equal(unknown.projection, "UNSUPPORTED_PROJECTION");
assert.equal("raw_result" in unknown, false);
assert.equal("logs" in unknown, false);
assert.deepEqual(unknown, projectOwnerDisplayPayload({ result_type: "future", raw_result: { different: true } }));

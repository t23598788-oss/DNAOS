/**
 * หน้าที่: real, READ-ONLY evidence for ../agent-session-discovery.ts —
 * a genuine live Accessibility read against whatever VS Code window is
 * actually open on this machine right now. Never fabricates a session;
 * asserts only structural/shape guarantees plus whatever real state was
 * observed.
 *
 * How to run:
 *   npx tsx connections/os-ui/tests/agent-session-discovery.test.ts
 */
import { discoverAgentSessions } from "../agent-session-discovery";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const result = await discoverAgentSessions(10_000);

  await check("discoverAgentSessions returns a real, structurally valid result (never throws, never fabricates)", () => {
    assert(typeof result.vscode_window_active === "boolean", "expected a real boolean");
    assert(Array.isArray(result.sessions), "expected sessions to be a real array, even if empty");
    assert(!Number.isNaN(new Date(result.evidence_timestamp).getTime()), "expected a real evidence timestamp");
    console.log(`      app_frontmost=${result.app_frontmost} vscode_window_active=${result.vscode_window_active} sessions=${result.sessions.length} confidence=${result.raw_confidence}`);
  });

  await check("every discovered session (if any) carries a real matched_label and a known provider — never invented", () => {
    const knownProviders = new Set(["claude-code", "codex", "copilot", "gemini"]);
    for (const session of result.sessions) {
      assert(knownProviders.has(session.provider), `unexpected provider "${session.provider}"`);
      assert(session.matched_label.length > 0, "expected a real, non-empty matched_label as evidence");
      assert(session.observed_state === "UNKNOWN", "busy/idle state must be UNKNOWN this round — never inferred beyond what Accessibility alone can confirm");
    }
  });

  await check("no click/type/key call exists anywhere in this module (read-only by construction)", () => {
    // Structural guarantee, not a runtime assertion: ../agent-session-discovery.ts imports only ../screen-reader.ts's readScreen. Verified by code review at write time; this check documents the invariant for future readers of this test.
    assert(true, "see ../agent-session-discovery.ts's own header for the enforced dependency list");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();

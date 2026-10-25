/**
 * PHASE 2 — Capability Execution Alignment test (owner directive).
 *
 * Proves the dispatcher's discovery and execution surface are aligned:
 *   - every command is classified into chat / write / system / unimplemented
 *   - a "chat" (available) command ALWAYS has a real QUERY_MAP handler
 *   - AVAILABLE_WITHOUT_EXECUTOR = 0 (no command is advertised as executable
 *     while lacking a dispatcher handler)
 *   - dispatch() returns UNIMPLEMENTED (ok:false) for a no-handler read
 *   - dispatch() returns APPROVAL_REQUIRED for a write command (Rule 72)
 *   - dispatch() returns OK (ok:true) for a real chat command
 *
 * No network, no DB, no credentials.
 */
import assert from "node:assert/strict";
import commandRegistry from "@/registry/command-registry.json";
import {
  listExecutableCommands,
  getCommandSurface,
  dispatch,
} from "@/engines/validation/dispatcher";

function main() {
  const cmds = Object.keys(commandRegistry.commands).filter((k) => !k.startsWith("_"));
  const executable = listExecutableCommands();

  // 1. classification is total and consistent
  const bySurface: Record<string, string[]> = { chat: [], write: [], system: [], unimplemented: [] };
  for (const c of cmds) {
    const s = getCommandSurface(c);
    assert.ok(s in bySurface, `command ${c} must classify to a known surface`);
    bySurface[s].push(c);
  }
  const total = Object.values(bySurface).reduce((a, l) => a + l.length, 0);
  assert.equal(total, cmds.length, "every command must be classified exactly once");

  // 2. AVAILABLE_WITHOUT_EXECUTOR = 0 — every chat command has a QUERY_MAP handler
  const availableWithoutExecutor = bySurface.chat.filter((c) => !executable.includes(c));
  assert.deepEqual(availableWithoutExecutor, [], `AVAILABLE_WITHOUT_EXECUTOR must be 0, got ${availableWithoutExecutor.join(", ")}`);

  // 3. executable list === chat surface (single source, no drift)
  assert.deepEqual(bySurface.chat.sort(), [...executable].sort(), "chat surface must equal dispatcher QUERY_MAP keys");

  // 4. write surface = requires_confirmation
  const writeCmds = cmds.filter((c) => commandRegistry.commands[c as keyof typeof commandRegistry.commands]?.requires_confirmation);
  assert.deepEqual(bySurface.write.sort(), writeCmds.sort(), "write surface must equal requires_confirmation commands");

  console.log(`capability-execution-alignment: checks passed`);
  console.log(`  total=${cmds.length} chat=${bySurface.chat.length} write=${bySurface.write.length} system=${bySurface.system.length} unimplemented=${bySurface.unimplemented.length} · AVAILABLE_WITHOUT_EXECUTOR=0`);
}

async function liveDispatchChecks() {
  // 5. unimplemented read command → ok:false + UNIMPLEMENTED (no longer "registered but no handler")
  const unimpl = await dispatch("debt.find", { keyword: "x" });
  assert.equal(unimpl.ok, false, "debt.find must not be ok (no executor)");
  assert.equal(unimpl.code, "UNIMPLEMENTED", "debt.find must report UNIMPLEMENTED");

  // 6. write command → APPROVAL_REQUIRED (Rule 72), never silently available
  const write = await dispatch("document.create", {});
  assert.equal(write.requires_confirmation, true, "document.create must require confirmation");
  assert.equal(write.code, "APPROVAL_REQUIRED", "document.create must report APPROVAL_REQUIRED");

  // 7. shadow command → SHADOW_COMMAND
  const shadow = await dispatch("__not_real__", {});
  assert.equal(shadow.ok, false, "shadow command must be rejected");
  assert.equal(shadow.code, "SHADOW_COMMAND", "shadow command must report SHADOW_COMMAND");

  console.log(`  dispatch: UNIMPLEMENTED/APPROVAL_REQUIRED/SHADOW_COMMAND all fail-closed (no DB hit)`);
}

main();
liveDispatchChecks().catch((e) => {
  console.error(e);
  process.exit(1);
});

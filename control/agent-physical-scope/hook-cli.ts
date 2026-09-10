#!/usr/bin/env node
/**
 * Optional Node entry for the Cursor hook. The live command is
 * `.cursor/hooks/dna-os-physical-scope.sh` (always valid JSON).
 * This file stays import-free so Node ESM never walks the TypeScript graph.
 */
import { createInterface } from "node:readline";

interface HookEvent {
  readonly command?: string;
  readonly file_path?: string;
  readonly path?: string;
  readonly tool_input?: { readonly command?: string; readonly path?: string };
}

const chunks: string[] = [];
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => chunks.push(line));
rl.on("close", () => {
  let event: HookEvent = {};
  try {
    const raw = chunks.join("\n").trim();
    if (raw) event = JSON.parse(raw) as HookEvent;
  } catch {
    process.stdout.write(JSON.stringify({ permission: "deny", agent_message: "TASK_SCOPE_UNRESOLVED" }));
    return;
  }
  const command = String(event.command || event.tool_input?.command || "");
  const path = String(event.file_path || event.path || event.tool_input?.path || "");
  const deny = (reason: string): void => {
    process.stdout.write(JSON.stringify({ permission: "deny", agent_message: reason, user_message: reason }));
  };
  if (/git\s+remote\s+(set-url|add)/.test(command)) {
    deny("GIT_SCOPE_DENIED");
    return;
  }
  if (/git[\s\S]*\bpush\b/.test(command) && (/:\/\//.test(command) || /git@/.test(command))) {
    deny("GIT_SCOPE_DENIED");
    return;
  }
  if (/(^|\s)kill\s+\d{2,}/.test(command)) {
    deny("RUNTIME_SCOPE_DENIED");
    return;
  }
  if (/:5181|\b5181\b|:8791|\b8791\b/.test(command)) {
    deny("PORT_SCOPE_DENIED");
    return;
  }
  if (/launchctl\s+(bootout|kickstart|kill)/.test(command)) {
    deny("RUNTIME_SCOPE_DENIED");
    return;
  }
  if (/^\/Users|\/Desktop\/DNA-OS|Application Support\/DNA OS|(^|[\s/])\.\.\//.test(path)) {
    deny("PATH_SCOPE_DENIED");
    return;
  }
  process.stdout.write(JSON.stringify({ permission: "allow", agent_message: "NON_CANONICAL_UNTRUSTED_EXECUTION" }));
});

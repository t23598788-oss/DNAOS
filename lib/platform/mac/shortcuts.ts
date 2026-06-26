/**
 * Shortcuts Executor — RUN_SHORTCUT
 */

import { runShell, type MacResult } from "./applescript";

export async function run(name: string, input?: string): Promise<MacResult> {
  const args = ["run", name];
  if (input) args.push("--input-type", "text", "--input", input);
  return runShell("shortcuts", args, 30000);
}

export async function list(): Promise<MacResult> {
  return runShell("shortcuts", ["list"]);
}

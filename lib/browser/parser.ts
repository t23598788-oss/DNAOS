/**
 * Command Parser — Browser Safe
 * ไม่ import child_process / osascript / runtime
 * อ่าน JSON Registry อย่างเดียว
 */

import type { CommandMatch, CommandEntry } from "@/lib/shared/types";
import commandData from "@/lib/commands/commands.json";

const commands = commandData as CommandEntry[];

export function matchCommand(text: string): CommandMatch | null {
  const t = text.toLowerCase().trim();
  for (const cmd of commands) {
    if (cmd.patterns.some((p) => t.includes(p))) {
      return { workflow: cmd.workflow, args: { app: cmd.app ?? "" } };
    }
  }
  return null;
}

export function listCommands(): { pattern: string; workflow: string }[] {
  return commands.flatMap((c) => c.patterns.map((p) => ({ pattern: p, workflow: c.workflow })));
}

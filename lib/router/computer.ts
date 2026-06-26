/**
 * V6 Computer Command — Browser Safe
 * parser อยู่ฝั่ง browser ได้ (อ่าน JSON อย่างเดียว)
 * execution อยู่ฝั่ง server เท่านั้น (ผ่าน /api/execute)
 */

import type { Command, CommandResult } from "@/types/command";
import { matchCommand } from "@/lib/browser/parser";

export function parseComputerCommand(text: string): Command | null {
  const match = matchCommand(text);
  if (!match) return null;
  return { action: `computer.${match.workflow}`, payload: { ...match.args, _workflow: match.workflow } };
}

export async function handleComputer(command: Command): Promise<CommandResult> {
  return {
    ok: true,
    command,
    data: {
      mode: "server_required",
      workflow: command.payload?._workflow,
      app: command.payload?.app,
      message: "Computer Control ต้อง execute ผ่าน /api/computer — ฝั่ง browser สั่ง macOS ไม่ได้",
    },
  };
}

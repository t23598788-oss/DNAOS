import type { Command, CommandResult } from "@/types/command";
import { openLine } from "@/lib/siri/shortcuts";

export async function handleLine(command: Command): Promise<CommandResult> {
  switch (command.action) {
    case "line.open": {
      openLine();
      return { ok: true, command, data: { opened: "line" } };
    }
    default:
      return { ok: false, command, error: `line: ไม่รองรับ ${command.action}` };
  }
}

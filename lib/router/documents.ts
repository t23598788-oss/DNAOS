import type { Command, CommandResult } from "@/types/command";
import { getDocuments } from "@/lib/supabase/queries";
import { openDrive } from "@/lib/siri/shortcuts";

export async function handleDocuments(command: Command): Promise<CommandResult> {
  switch (command.action) {
    case "document.list": {
      const data = await getDocuments();
      return { ok: true, command, data };
    }
    case "drive.open": {
      openDrive();
      return { ok: true, command, data: { opened: "drive" } };
    }
    default:
      return { ok: false, command, error: `document: ไม่รองรับ ${command.action}` };
  }
}

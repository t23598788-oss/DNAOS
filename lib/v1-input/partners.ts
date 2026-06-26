import type { Command, CommandResult } from "@/types/command";
import { getPartners, getMaterialTypes } from "@/lib/supabase/queries";

export async function handlePartners(command: Command): Promise<CommandResult> {
  switch (command.action) {
    case "partner.list": {
      const data = await getPartners();
      return { ok: true, command, data };
    }
    case "material.list": {
      const data = await getMaterialTypes();
      return { ok: true, command, data };
    }
    default:
      return { ok: false, command, error: `partner: ไม่รองรับ ${command.action}` };
  }
}

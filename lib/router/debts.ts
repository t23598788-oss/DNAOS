import type { Command, CommandResult } from "@/types/command";
import { getDebts } from "@/lib/supabase/queries";

export async function handleDebts(command: Command): Promise<CommandResult> {
  switch (command.action) {
    case "debt.list": {
      const data = await getDebts();
      return { ok: true, command, data };
    }
    default:
      return { ok: false, command, error: `debt: ไม่รองรับ ${command.action}` };
  }
}

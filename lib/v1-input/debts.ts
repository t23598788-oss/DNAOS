import type { Command, CommandResult } from "@/types/command";
import { getOpenDebts, getAllDebts, getDebtTrackings, createDebtTracking } from "@/lib/supabase/queries";

export async function handleDebts(command: Command): Promise<CommandResult> {
  switch (command.action) {
    case "debt.list": {
      const data = await getOpenDebts();
      return { ok: true, command, data };
    }
    case "debt.all": {
      const data = await getAllDebts();
      return { ok: true, command, data };
    }
    case "debt.trackings": {
      const data = await getDebtTrackings();
      return { ok: true, command, data };
    }
    case "debt.create": {
      if (!command.payload?.customer_name || !command.payload?.principal_amount) {
        return { ok: false, command, error: "ต้องระบุ customer_name และ principal_amount" };
      }
      const data = await createDebtTracking(command.payload);
      return { ok: true, command, data };
    }
    default:
      return { ok: false, command, error: `debt: ไม่รองรับ ${command.action}` };
  }
}

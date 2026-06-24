import type { Command, CommandResult } from "@/types/command";
import { getLatestInvoice, getDocuments, createDocument } from "@/lib/supabase/queries";

export async function handleInvoices(command: Command): Promise<CommandResult> {
  switch (command.action) {
    case "invoice.latest": {
      const data = await getLatestInvoice();
      return { ok: true, command, data };
    }
    case "invoice.list": {
      const data = await getDocuments("invoice");
      return { ok: true, command, data };
    }
    case "invoice.create": {
      if (!command.payload?.party_name || !command.payload?.net_amount) {
        return { ok: false, command, error: "ต้องระบุ party_name และ net_amount" };
      }
      const data = await createDocument({
        document_type: "invoice",
        document_number: command.payload.document_number ?? `INV-${Date.now()}`,
        party_name: command.payload.party_name,
        net_amount: command.payload.net_amount,
        issue_date: command.payload.issue_date,
        note: command.payload.note,
      });
      return { ok: true, command, data };
    }
    default:
      return { ok: false, command, error: `invoice: ไม่รองรับ ${command.action}` };
  }
}

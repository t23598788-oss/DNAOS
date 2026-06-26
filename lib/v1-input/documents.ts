import type { Command, CommandResult } from "@/types/command";
import { getDocuments, getReceipts, createDocument, getPendingDrafts } from "@/lib/supabase/queries";

export async function handleDocuments(command: Command): Promise<CommandResult> {
  switch (command.action) {
    case "document.list": {
      const data = await getDocuments();
      return { ok: true, command, data };
    }
    case "document.boq": {
      const data = await getDocuments("boq");
      return { ok: true, command, data };
    }
    case "document.po": {
      const data = await getDocuments("purchase-order");
      return { ok: true, command, data };
    }
    case "document.do": {
      const data = await getDocuments("delivery-order");
      return { ok: true, command, data };
    }
    case "document.receipt": {
      const data = await getReceipts();
      return { ok: true, command, data };
    }
    case "receipt.create": {
      if (!command.payload?.party_name || !command.payload?.net_amount) {
        return { ok: false, command, error: "ต้องระบุ party_name และ net_amount" };
      }
      const data = await createDocument({
        document_type: "receipt",
        document_number: command.payload.document_number ?? `REC-${Date.now()}`,
        party_name: command.payload.party_name,
        net_amount: command.payload.net_amount,
        issue_date: command.payload.issue_date,
        note: command.payload.note,
      });
      return { ok: true, command, data };
    }
    case "document.create": {
      if (!command.payload?.document_type || !command.payload?.party_name || !command.payload?.net_amount) {
        return { ok: false, command, error: "ต้องระบุ document_type, party_name, net_amount" };
      }
      const data = await createDocument({
        document_type: command.payload.document_type,
        document_number: command.payload.document_number ?? `DOC-${Date.now()}`,
        party_name: command.payload.party_name,
        net_amount: command.payload.net_amount,
        issue_date: command.payload.issue_date,
        note: command.payload.note,
      });
      return { ok: true, command, data };
    }
    case "draft.list": {
      const data = await getPendingDrafts();
      return { ok: true, command, data };
    }
    default:
      return { ok: false, command, error: `document: ไม่รองรับ ${command.action}` };
  }
}

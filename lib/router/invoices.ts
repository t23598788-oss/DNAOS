import type { Command, CommandResult } from "@/types/command";
import { getLatestInvoice, getInvoices } from "@/lib/supabase/queries";
import { sendLineMessage } from "@/lib/siri/shortcuts";

export async function handleInvoices(command: Command): Promise<CommandResult> {
  switch (command.action) {
    case "invoice.latest": {
      const data = await getLatestInvoice();
      return { ok: true, command, data };
    }
    case "invoice.list": {
      const data = await getInvoices();
      return { ok: true, command, data };
    }
    case "invoice.send_latest": {
      const inv = await getLatestInvoice();
      if (!inv) return { ok: false, command, error: "ไม่พบใบแจ้งหนี้ล่าสุด" };
      const message = `ใบแจ้งหนี้ ${inv.invoice_no} ยอด ${inv.amount} บาท`;
      sendLineMessage(inv.contact ?? "", message);
      return { ok: true, command, data: { sent: true, invoice: inv, message } };
    }
    default:
      return { ok: false, command, error: `invoice: ไม่รองรับ ${command.action}` };
  }
}

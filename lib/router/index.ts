import type { Command, CommandResult } from "@/types/command";
import { handleDebts } from "./debts";
import { handleInvoices } from "./invoices";
import { handleDocuments } from "./documents";
import { handleLine } from "./line";

/**
 * แปลงคำสั่งภาษาไทย -> Command Object
 * รองรับการ match แบบ keyword (กฎง่ายๆ ก่อน ค่อยอัปเกรดเป็น NLP/LLM ภายหลัง)
 */
export function parseCommand(raw: string): Command {
  const text = raw.trim();
  const t = text.toLowerCase();

  // ---- LINE ----
  if (t.includes("ส่งใบแจ้งหนี้ล่าสุด"))
    return { action: "invoice.send_latest", payload: { source: text } };
  if (t.includes("เปิด line") || t.includes("เปิดไลน์") || t === "line")
    return { action: "line.open" };

  // ---- INVOICE ----
  if (t.includes("ใบแจ้งหนี้ล่าสุด"))
    return { action: "invoice.latest" };
  if (t.includes("ใบแจ้งหนี้"))
    return { action: "invoice.list" };

  // ---- DEBT ----
  if (t.includes("ลูกหนี้ทั้งหมด") || t.includes("ลูกหนี้"))
    return { action: "debt.list" };

  // ---- DOCUMENT / DRIVE ----
  if (t.includes("เปิด drive") || t.includes("เปิดไดรฟ์") || t.includes("ไดรฟ์"))
    return { action: "drive.open" };
  if (t.includes("เอกสาร"))
    return { action: "document.list" };

  return { action: "unknown", payload: { source: text } };
}

/**
 * Dispatch Command Object -> Handler -> Result
 */
export async function dispatch(command: Command): Promise<CommandResult> {
  try {
    const [domain] = command.action.split(".");

    switch (domain) {
      case "debt":
        return await handleDebts(command);
      case "invoice":
        return await handleInvoices(command);
      case "document":
      case "drive":
        return await handleDocuments(command);
      case "line":
        return await handleLine(command);
      default:
        return {
          ok: false,
          command,
          error: `ไม่รู้จักคำสั่ง: ${command.action}`,
        };
    }
  } catch (e: any) {
    return { ok: false, command, error: e?.message ?? "internal error" };
  }
}

/**
 * Entry point หลัก: text -> parse -> dispatch -> result
 */
export async function runCommand(raw: string): Promise<CommandResult> {
  const command = parseCommand(raw);
  return dispatch(command);
}

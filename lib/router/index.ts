import type { Command, CommandResult } from "@/types/command";
import { handleDebts } from "./debts";
import { handleInvoices } from "./invoices";
import { handleDocuments } from "./documents";
import { handleJobs } from "./jobs";
import { handlePartners } from "./partners";
import { handleLine } from "./line";
import { handleComputer, parseComputerCommand } from "./computer";

export function parseCommand(raw: string): Command {
  const text = raw.trim();
  const t = text.toLowerCase();

  // ---- DEBT / ลูกหนี้ ----
  if (t.includes("หนี้ค้าง") || t.includes("หนี้เปิด"))
    return { action: "debt.list" };
  if (t.includes("หนี้ทั้งหมด"))
    return { action: "debt.all" };
  if (t.includes("ลูกหนี้ทั้งหมด") || t.includes("ลูกหนี้"))
    return { action: "debt.trackings" };

  // ---- INVOICE / ใบแจ้งหนี้ ----
  if (t.includes("ใบแจ้งหนี้ล่าสุด"))
    return { action: "invoice.latest" };
  if (t.includes("ใบแจ้งหนี้"))
    return { action: "invoice.list" };

  // ---- DOCUMENT / เอกสาร ----
  if (t.includes("ใบเสนอราคา") || t.includes("boq"))
    return { action: "document.boq" };
  if (t.includes("ใบสั่งซื้อ") || t.includes("po"))
    return { action: "document.po" };
  if (t.includes("ใบส่งของ") || t.includes("do"))
    return { action: "document.do" };
  if (t.includes("ใบเสร็จรับเงิน") || t.includes("ใบเสร็จ") || t.includes("receipt"))
    return { action: "document.receipt" };
  if (t.includes("ร่างรออนุมัติ") || t.includes("draft"))
    return { action: "draft.list" };
  if (t.includes("เอกสาร"))
    return { action: "document.list" };

  // ---- JOB / งาน ----
  if (t.includes("งานกำลังส่ง") || t.includes("งานค้าง"))
    return { action: "job.active" };
  if (t.includes("งานทั้งหมด") || t.includes("งาน"))
    return { action: "job.list" };

  // ---- PARTNER / คู่ค้า ----
  if (t.includes("คู่ค้า") || t.includes("ลูกค้า") || t.includes("partner"))
    return { action: "partner.list" };
  if (t.includes("วัสดุ") || t.includes("material"))
    return { action: "material.list" };

  // ---- DRIVE ----
  if (t.includes("เปิด drive") || t.includes("เปิดไดรฟ์") || t.includes("ไดรฟ์"))
    return { action: "drive.open" };

  // ---- V6 COMPUTER (ใช้ Workflow Registry) ----
  const computerCmd = parseComputerCommand(text);
  if (computerCmd) return computerCmd;

  return { action: "unknown", payload: { source: text } };
}

export async function dispatch(command: Command): Promise<CommandResult> {
  try {
    const [domain] = command.action.split(".");

    switch (domain) {
      case "debt":
        return await handleDebts(command);
      case "invoice":
        return await handleInvoices(command);
      case "document":
      case "draft":
      case "receipt":
        return await handleDocuments(command);
      case "job":
        return await handleJobs(command);
      case "partner":
      case "material":
        return await handlePartners(command);
      case "line":
        return await handleLine(command);
      case "drive":
        return await handleDocuments(command);
      case "computer":
        return await handleComputer(command);
      default:
        return {
          ok: false,
          command,
          error: `ไม่รู้จักคำสั่ง: ${command.action}`,
        };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "internal error";
    return { ok: false, command, error: msg };
  }
}

export async function runCommand(raw: string): Promise<CommandResult> {
  const command = parseCommand(raw);
  return dispatch(command);
}

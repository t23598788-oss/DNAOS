import { NextResponse } from 'next/server';
import { getDocuments, getOpenDebts, getDebtTrackings, getPartners, getJobs, getMaterialTypes } from "@/lib/supabase/queries";

let globalDisplayState: any = {
  activeView: 'IDLE',
  data: {}
};

async function interpret(command: string) {
  const q = command.toLowerCase();

  // ── ลูกค้า / คู่ค้า ──
  if (/ลูกค้า|คู่ค้า|partner/.test(q)) {
    const all = await getPartners().catch(() => []) ?? [];
    const name = q.replace(/ดู|หา|เปิด|ลูกค้า|คู่ค้า|ของ|คุณ|partner/g, "").trim();

    if (name) {
      const found = all.filter((p: any) => p.name?.toLowerCase().includes(name));
      if (found.length === 1) {
        return { activeView: "PARTNER_DETAIL", data: found[0] };
      }
      if (found.length > 1) {
        return { activeView: "PARTNER_PICK", data: { keyword: name, items: found } };
      }
      return { activeView: "NOT_FOUND", data: { text: `ไม่พบลูกค้าชื่อ "${name}"` } };
    }
    return { activeView: "PARTNER_LIST", data: { items: all } };
  }

  // ── ใบแจ้งหนี้ ──
  if (/ใบแจ้งหนี้|invoice/.test(q)) {
    const all = await getDocuments("invoice").catch(() => []) ?? [];
    return { activeView: "INVOICE_LIST", data: { items: all } };
  }

  // ── เอกสาร ──
  if (/เอกสาร|document|ใบเสร็จ|ใบเสนอราคา/.test(q)) {
    const t = /ใบเสร็จ/.test(q) ? "receipt" : /ใบเสนอราคา/.test(q) ? "quotation" : undefined;
    const all = await getDocuments(t).catch(() => []) ?? [];
    return { activeView: "DOC_LIST", data: { items: all, type: t ?? "ทั้งหมด" } };
  }

  // ── หนี้ ──
  if (/หนี้|debt|ลูกหนี้/.test(q)) {
    const debts = await getOpenDebts().catch(() => []) ?? [];
    return { activeView: "DEBT_LIST", data: { items: debts } };
  }

  // ── งาน ──
  if (/งาน|job|จัดส่ง|โปรเจกต์/.test(q)) {
    const all = await getJobs().catch(() => []) ?? [];
    const name = q.replace(/ดู|หา|เปิด|งาน|ของ|คุณ|จัดส่ง|โปรเจกต์/g, "").trim();

    if (name) {
      const found = all.filter((j: any) =>
        j.project_name?.toLowerCase().includes(name) ||
        j.contact_name?.toLowerCase().includes(name)
      );
      if (found.length === 1) {
        return { activeView: "JOB_DETAIL", data: found[0] };
      }
      if (found.length > 1) {
        return { activeView: "JOB_PICK", data: { keyword: name, items: found } };
      }
      return { activeView: "NOT_FOUND", data: { text: `ไม่พบงานชื่อ "${name}"` } };
    }
    return { activeView: "JOB_LIST", data: { items: all } };
  }

  // ── วัสดุ ──
  if (/วัสดุ|material|หิน|ทราย|ดิน/.test(q)) {
    const all = await getMaterialTypes().catch(() => []) ?? [];
    return { activeView: "MATERIAL_LIST", data: { items: all } };
  }

  // ── ซ่อน / ล้าง ──
  if (/ซ่อน|ล้าง|clear|reset/.test(q)) {
    return { activeView: "IDLE", data: {} };
  }

  return { activeView: "UNKNOWN", data: { text: command } };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.userCommand) {
      globalDisplayState = await interpret(body.userCommand);
    } else if (body.command) {
      globalDisplayState = { activeView: body.command, data: body.payload || {} };
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: "รหัสคำสั่งไม่ถูกต้อง" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json(globalDisplayState);
}

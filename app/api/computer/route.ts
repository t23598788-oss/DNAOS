/**
 * V6 Computer Control API — Server-side only
 * Browser → /api/computer → Engine → Driver → Runtime → macOS
 */

import { NextRequest, NextResponse } from "next/server";
import { isLocalMac } from "@/lib/runtime/platform";

export async function POST(req: NextRequest) {
  if (!isLocalMac()) {
    return NextResponse.json({ ok: false, error: "Computer Control ทำงานได้เฉพาะ macOS local" }, { status: 400 });
  }

  const body = await req.json();
  const { workflow, app, args = {} } = body as { workflow?: string; app?: string; args?: Record<string, string> };

  if (!workflow) {
    return NextResponse.json({ ok: false, error: "ต้องระบุ workflow" }, { status: 400 });
  }

  // Dynamic import — child_process อยู่เฉพาะฝั่ง server
  const { register } = await import("@/lib/core/registry");
  const { get, list } = await import("@/lib/core/registry");
  const { execute } = await import("@/lib/core/engine");

  // Register drivers (lazy)
  const line = (await import("@/lib/drivers/line")).default;
  const chrome = (await import("@/lib/drivers/chrome")).default;
  const vscode = (await import("@/lib/drivers/vscode")).default;
  const finder = (await import("@/lib/drivers/finder")).default;
  const terminal = (await import("@/lib/drivers/terminal")).default;
  const maps = (await import("@/lib/drivers/maps")).default;
  const earth = (await import("@/lib/drivers/earth")).default;
  const mail = (await import("@/lib/drivers/mail")).default;
  const calendar = (await import("@/lib/drivers/calendar")).default;
  const pdf = (await import("@/lib/drivers/pdf")).default;
  const github = (await import("@/lib/drivers/github")).default;
  [line, chrome, vscode, finder, terminal, maps, earth, mail, calendar, pdf, github].forEach(register);

  if (workflow === "system.status") {
    const statuses: Record<string, string> = {};
    for (const name of list()) {
      const d = get(name);
      if (d) try { statuses[name] = await d.status(); } catch { statuses[name] = "unknown"; }
    }
    return NextResponse.json({ ok: true, apps: statuses });
  }

  if (!app) {
    return NextResponse.json({ ok: false, error: "ต้องระบุ app" }, { status: 400 });
  }

  const driver = get(app);
  if (!driver) {
    return NextResponse.json({ ok: false, error: `ไม่พบ driver: ${app} — มี: ${list().join(", ")}` }, { status: 400 });
  }

  const result = await execute(workflow, { ...args, app }, driver);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

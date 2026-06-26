/**
 * V6 Computer Control API — Server-side only
 * Browser → /api/computer → Engine → Driver → Runtime → macOS
 */

import { NextRequest, NextResponse } from "next/server";
import { isLocalMac } from "@/lib/v6-executor/runtime/platform";

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
  const { register } = await import("@/lib/v6-executor/core/registry");
  const { get, list } = await import("@/lib/v6-executor/core/registry");
  const { execute } = await import("@/lib/v6-executor/core/engine");

  // Register drivers (lazy)
  const line = (await import("@/lib/v6-executor/drivers/line")).default;
  const chrome = (await import("@/lib/v6-executor/drivers/chrome")).default;
  const vscode = (await import("@/lib/v6-executor/drivers/vscode")).default;
  const finder = (await import("@/lib/v6-executor/drivers/finder")).default;
  const terminal = (await import("@/lib/v6-executor/drivers/terminal")).default;
  const maps = (await import("@/lib/v6-executor/drivers/maps")).default;
  const earth = (await import("@/lib/v6-executor/drivers/earth")).default;
  const mail = (await import("@/lib/v6-executor/drivers/mail")).default;
  const calendar = (await import("@/lib/v6-executor/drivers/calendar")).default;
  const pdf = (await import("@/lib/v6-executor/drivers/pdf")).default;
  const github = (await import("@/lib/v6-executor/drivers/github")).default;
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

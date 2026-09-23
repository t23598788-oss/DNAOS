// Screen Vision, read-only (owner, 2026-07-30): "อ่านสิ่งที่อยู่บนจอเฮียเอง
// ตอนที่เฮียสั่งเอง" — src-tauri/src/lib.rs's `capture_screen` Tauri command
// runs macOS's own `screencapture` CLI (on explicit command only, never a
// background watcher) and saves to a fixed local path; this route reads that
// file straight off disk (both this Next.js server and the Tauri app run on the
// SAME Mac) and asks DNA OS for the `screen.describe` AI capability to
// transcribe/describe what is actually on screen. Never clicks or types
// anything — read-only, by design.
//
// A6 cutover (owner, 2026-09-23): this route no longer knows a provider, a model
// or an endpoint. It states the capability and the resolver + adapter registry
// decide what runs,
// emitting provenance/evidence through the same canonical gateway every other AI
// caller uses. The effective model is unchanged: the registry declares
// the vision model as adapter configuration (proven from this very route before
// the cutover), so behaviour is preserved while the caller's provider knowledge
// is gone.
//
// Requires the built .app to have real macOS Screen Recording permission
// granted once (System Settings → Privacy & Security → Screen Recording) —
// a one-time OS-level grant, separate from Tauri's own capability system;
// without it, screencapture silently produces a black/empty image.
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { invokeAiGateway } from "@/services/ai/gateway";

const SCREENSHOT_PATH = "/tmp/dna_os_screen_capture.png";

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  let goal: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.goal === "string" && body.goal.trim()) goal = body.goal.trim();
  } catch {
    // no body / not JSON — fine, goal stays undefined (plain read-and-translate)
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = await readFile(SCREENSHOT_PATH);
  } catch {
    return NextResponse.json({ error: "ยังไม่มีไฟล์ภาพหน้าจอ — ลองสั่งอ่านหน้าจออีกครั้งครับ" }, { status: 404 });
  }

  const b64 = imageBuffer.toString("base64");

  // Vision-Guided Step Assistant (owner, 2026-07-30): "เป็นหูเป็นตาเป็น
  // ประสาทสัมผัสช่วย...บอกว่าช่องนี้คืออะไร กดตรงไหน...ไม่ใช่เขียนโค้ดล็อก
  // ไว้ตายตัว" — he explicitly does NOT want a hardcoded/scripted automation
  // that breaks the moment a website's layout changes, and separately does
  // NOT get synthetic clicking (declined, same reasoning as the Accessibility
  // API proposal) — what closes the real gap is live vision reading that
  // adapts to whatever is ACTUALLY on screen right now and tells him exactly
  // where to click next, toward a goal he states once. He clicks; the model
  // only ever describes/reads, same read-only boundary as before.
  const prompt = goal
    ? `ดูภาพหน้าจอนี้ ผู้ใช้กำลังพยายามทำสิ่งนี้: "${goal}" ตอบเป็นภาษาไทยล้วน 3 ส่วน:\n1) หน้าจอนี้กำลังแสดงอะไรอยู่ (สรุปสั้นๆ)\n2) แปลข้อความภาษาอังกฤษสำคัญที่เกี่ยวข้องกับเป้าหมายนี้เป็นภาษาไทยให้ครบถ้วน\n3) บอกขั้นตอนถัดไปที่ต้องทำจริง ชี้ตำแหน่งปุ่ม/ช่อง/ลิงก์ที่เห็นในภาพอย่างเจาะจง (เช่น สี ตำแหน่งบนจอ ข้อความบนปุ่ม) เพื่อให้ผู้ใช้กดเองได้ถูกจุด — ถ้าไม่เห็นสิ่งที่ต้องกดในภาพนี้ ให้บอกตรงๆ ว่าไม่เห็น อย่าเดา\nห้ามแต่งเติมสิ่งที่ไม่เห็นในภาพจริง`
    : "ดูภาพหน้าจอนี้ ทำ 2 อย่างเป็นภาษาไทยล้วน:\n1) แปลข้อความภาษาอังกฤษทุกส่วนที่เห็นในภาพให้ครบถ้วนเป็นภาษาไทย (ไม่ใช่แค่สรุปสั้นๆ) — ถ้าไม่มีภาษาอังกฤษในภาพ ให้บอกว่าไม่มี\n2) สรุปสั้นๆ ว่าหน้าจอนี้กำลังแสดงอะไรอยู่ (เช่น กำลังคุยแชทกับใคร หรือเป็นหน้าจอโปรแกรม/เว็บไซต์อะไร)\nห้ามแต่งเติมสิ่งที่ไม่เห็นในภาพจริง";

  try {
    // Capability only — no provider, no model, no endpoint (A6.1).
    const result = await invokeAiGateway({
      origin: "api/admin/screen-vision",
      ownerId: auth.email,
      sessionId: request.headers.get("x-dna-session") ?? "screen-vision",
      capability: "screen.describe",
      effect: "analysis",
      prompt,
      image: { base64: b64, mediaType: "image/png" },
      maxTokens: 900,
    });
    if (!result.ok) {
      const message = result.error ?? "unknown AI failure";
      if (message.includes("AI_GATEWAY_EMPTY_PROVIDER_RESULT")) {
        return NextResponse.json({ error: "อ่านภาพหน้าจอไม่ได้ผลลัพธ์ — ลองใหม่อีกครั้งครับ" }, { status: 502 });
      }
      return NextResponse.json({ error: `เรียกโมเดลอ่านภาพไม่สำเร็จ: ${message}` }, { status: 502 });
    }
    const text = (result.output ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "อ่านภาพหน้าจอไม่ได้ผลลัพธ์ — ลองใหม่อีกครั้งครับ" }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json({ error: `เรียกโมเดลอ่านภาพไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}

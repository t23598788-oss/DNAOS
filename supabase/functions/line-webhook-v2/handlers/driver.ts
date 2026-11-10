// LINE webhook handler for driver replies: maps Thai ETA commands
// ("eta 1กข-1234", "รถ … ถึงไหน") through computeDriverEta and answers the chat.
import type { HandlerContext, LineMessageEvent, LineTextMessage } from "../events/types.ts";
import { saveEvent } from "../events/store.ts";
import { ResponseGateway } from "../engines/response.ts";
import { computeDriverEta } from "../engines/driver-eta.ts";

export async function handleDriver(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent;
  const msg = msgEvent.message as LineTextMessage;
  const text = msg.text ?? "";

  const saved = await saveEvent(ctx.supabase, {
    event: ctx.event,
    userId: ctx.userId,
    groupId: ctx.groupId,
    channelDestination: ctx.channelDestination,
    rawType: "text",
    rawText: text,
  });

  if (saved?.duplicate) return;

  const trimmed = text.trim();

  // Map common Thai driver commands to ETA
  const cmd = trimmed.toLowerCase();
  if (cmd === "eta" || cmd === "คำนวณเอต้า" || cmd.startsWith("รถ") && cmd.includes("ถึง")) {
    // Driver sends: "eta [license plate]" or "รถ [plate] ถึงไหน"
    const plate = cmd.includes("eta") ? cmd.replace("eta", "").trim() : null;
    const match = trimmed.match(/แผ่นที่\s*(\S+)/i) || trimmed.match(/(\d{2,3}[-]\d{3,4})/);
    const licensePlate = plate || (match?.[1] || "");

    if (!licensePlate) {
      await ResponseGateway.replyText(ctx.replyToken, "ใช้คำสั่ง: eta [หมายเลขรถ]\nตัวอย่าง: eta AA-1234");
      return;
    }

    // In production, look up trip by license_plate and compute ETA.
    // For now: placeholder — the trip lookup is from jobs/trips tables.
    await ResponseGateway.replyText(ctx.replyToken, `คำนวณ ETA สำหรับ ${licensePlate}... (drivers/eta endpoint)`);
    return;
  }

  // Generic echo with quick replies for driver actions
  await ResponseGateway.replyText(ctx.replyToken, `รับคำสั่ง: ${trimmed}\n\nเลือก:\n1. ตรวจสอบ ETA\n2. รายงานความล่าช้า\n3. ระบบแม่นยำ (LINE Bot)`);
}

import { saveEvent } from "../events/store.ts";
import { ResponseGateway } from "../engines/response.ts";
import { computeDriverEta } from "../engines/driver-eta.ts";

export async function handleDriver(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent;
  const msg = msgEvent.message as LineTextMessage;
  const text = msg.text ?? "";

  const saved = await saveEvent(ctx.supabase, {
    event: ctx.event,
    userId: ctx.userId,
    groupId: ctx.groupId,
    channelDestination: ctx.channelDestination,
    rawType: "text",
    rawText: text,
  });

  if (saved?.duplicate) return;

  const trimmed = text.trim();

  // Map common Thai driver commands to ETA
  const cmd = trimmed.toLowerCase();
  if (cmd === "eta" || cmd === "คำนวณเอต้า" || cmd.startsWith("รถ") && cmd.includes("ถึง")) {
    // Driver sends: "eta [license plate]" or "รถ [plate] ถึงไหน"
    const plate = cmd.includes("eta") ? cmd.replace("eta", "").trim() : null;
    const match = trimmed.match(/แผ่นที่\s*(\S+)/i) || trimmed.match(/(\d{2,3}[-]\d{3,4})/);
    const licensePlate = plate || (match?.[1] || "");

    if (!licensePlate) {
      await ResponseGateway.replyText(ctx.replyToken, "ใช้คำสั่ง: eta [หมายเลขรถ]\nตัวอย่าง: eta AA-1234");
      return;
    }

    // In production, look up trip by license_plate and compute ETA.
    // For now: placeholder — the trip lookup is from jobs/trips tables.
    await ResponseGateway.replyText(ctx.replyToken, `คำนวณ ETA สำหรับ ${licensePlate}... (drivers/eta endpoint)`);
    return;
  }

  // Generic echo with quick replies for driver actions
  await ResponseGateway.replyText(ctx.replyToken, `รับคำสั่ง: ${trimmed}\n\nเลือก:\n1. ตรวจสอบ ETA\n2. รายงานความล่าช้า\n3. ระบบแม่นยำ (LINE Bot)`);
}

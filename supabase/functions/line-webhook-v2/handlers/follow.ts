import type { HandlerContext } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { ResponseGateway } from "../engines/response.ts"

export async function handleFollow(ctx: HandlerContext): Promise<void> {
  await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    rawType: "follow",
    rawText: "follow",
  })

  // Community-first greeting (owner, 2026-07-25): "ดึงคนทุกประเภทเข้ามาอยู่
  // กลุ่มเดียวกัน...คำต้อนรับแรกคือซอสโค้ดเด็ดที่ทำให้ผู้ใช้ไม่หลง" — one LINE
  // account serves multiple, growing service lines. Owner correction same
  // day, after seeing the first version enumerate each service by name:
  // "ถ้าวันนึงมีบริษัทเข้ามาร่วมเป็น 1000 น่ะ มึงจะไม่มีข้อความต้อนรับเป็น
  // หางว่าวเลยหรอ" — a greeting that lists every capability by name breaks
  // the moment a 3rd/10th/1000th service joins. State the general
  // capability (send whatever you need — text or a photo — and it gets
  // handled) instead of an enumerated list that needs editing per launch.
  const welcome =
    "ยินดีต้อนรับครับ! 🎉\n\n" +
    "มีอะไรต้องการก็พิมพ์บอก หรือส่งรูปมาได้เลยครับ ระบบจะช่วยจัดการให้ทันที"

  await ResponseGateway.pushMessage(ctx.userId, welcome)
}

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

  const welcome =
    "ยินดีต้อนรับสู่ DNA OS ครับ! 🎉\n\n" +
    "พิมพ์วัสดุที่ต้องการได้เลย เช่น\n" +
    '"ต้องการหินคลุก 50 ตัน ส่งไซต์ลาดกระบัง"\n\n' +
    "ระบบจะจับคู่บ่อวัสดุและแจ้งราคาให้ทันที"

  await ResponseGateway.pushMessage(ctx.userId, welcome)
}

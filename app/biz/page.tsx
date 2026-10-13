import { redirect } from "next/navigation"
import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"
import { BIZ_SECTIONS } from "./_lib/sections"

/** ทางเข้า Business Workspace ใหม่ — ส่งไป section แรกของแถบนำทาง */
export default async function BizIndexPage() {
  await requireAuthPage("/biz", ADMIN_TIER)
  redirect(`/biz/${BIZ_SECTIONS[0].key}`)
}

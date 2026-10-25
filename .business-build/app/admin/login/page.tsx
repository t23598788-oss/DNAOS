import { redirect } from "next/navigation"

// TASK-001 (SSO): one real login page for the whole system now lives at
// /login (see app/login/page.tsx). This route is kept only so old
// bookmarks/links to /admin/login still land somewhere real instead of
// 404ing — it is not a second login form.
export default async function AdminLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const next = params.next ?? "/admin"
  redirect(`/login?next=${encodeURIComponent(next)}`)
}
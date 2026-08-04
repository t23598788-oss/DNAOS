/**
 * GET /oauth/authorize — the spec's "user authorizes" step. The "user"
 * here is the DNA OS admin, gated by the same real session check every
 * other /admin page uses (requireAuthPage). Renders a real approve/deny
 * form — approval posts to /api/oauth/authorize, which does the actual
 * authorization-code creation server-side (this page never creates one
 * itself, so a page reload or link-share can't accidentally re-approve).
 */
import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { ADMIN_TIER } from "@/core/auth/session"
import { validateRedirectUri } from "@/services/ai-connection/oauth"
import { canonicalMcpResourceUri } from "@/services/ai-connection/resourceConfig"
import { serviceClient } from "@/services/supabase/api-tokens"

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AuthorizePage({ searchParams }: PageProps) {
  const user = await requireAuthPage("/oauth/authorize", ADMIN_TIER)
  const params = await searchParams

  const clientId = String(params.client_id ?? "")
  const redirectUri = String(params.redirect_uri ?? "")
  const codeChallenge = String(params.code_challenge ?? "")
  const codeChallengeMethod = String(params.code_challenge_method ?? "")
  const resource = String(params.resource ?? "")
  const state = String(params.state ?? "")

  const errors: string[] = []
  if (!clientId) errors.push("ไม่พบ client_id")
  if (!redirectUri) errors.push("ไม่พบ redirect_uri")
  if (codeChallengeMethod !== "S256") errors.push("ต้องใช้ code_challenge_method=S256 เท่านั้น")
  if (!codeChallenge) errors.push("ไม่พบ code_challenge")
  if (resource !== canonicalMcpResourceUri()) errors.push("resource ไม่ตรงกับ DNA OS MCP endpoint จริง")

  let clientName = clientId
  let redirectValid = false
  if (clientId && errors.length === 0) {
    redirectValid = await validateRedirectUri(clientId, redirectUri)
    if (!redirectValid) errors.push("redirect_uri ไม่ตรงกับที่ลงทะเบียนไว้ (ป้องกัน open redirect)")

    const { data } = await serviceClient().from("oauth_clients").select("client_name").eq("client_id", clientId).maybeSingle()
    if (data) clientName = (data as { client_name: string }).client_name
  }

  const canApprove = errors.length === 0

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 font-mono flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-stone-800 border border-stone-700 rounded-2xl p-6">
        <h1 className="text-lg font-bold mb-1">อนุมัติการเชื่อมต่อ AI Connection</h1>
        <p className="text-xs text-stone-400 mb-4">เข้าสู่ระบบในฐานะ {user.email}</p>

        {errors.length > 0 ? (
          <div className="bg-rose-900/30 border border-rose-800 rounded-xl p-3 text-sm text-rose-300 space-y-1">
            {errors.map((e) => <div key={e}>• {e}</div>)}
          </div>
        ) : (
          <>
            <div className="bg-stone-900 border border-stone-700 rounded-xl p-3 mb-4 text-sm">
              <div className="text-stone-400 text-[11px] uppercase mb-1">Client</div>
              <div className="font-semibold">{clientName}</div>
              <div className="text-stone-500 text-[10px] mt-1 break-all">{clientId}</div>
            </div>
            <form method="POST" action="/api/oauth/authorize" className="space-y-3">
              <input type="hidden" name="client_id" value={clientId} />
              <input type="hidden" name="redirect_uri" value={redirectUri} />
              <input type="hidden" name="code_challenge" value={codeChallenge} />
              <input type="hidden" name="resource" value={resource} />
              <input type="hidden" name="state" value={state} />
              <div className="flex gap-2">
                <button name="decision" value="deny" className="flex-1 py-2.5 rounded-xl bg-stone-700 hover:bg-stone-600 text-sm font-semibold">
                  ปฏิเสธ
                </button>
                <button name="decision" value="approve" disabled={!canApprove} className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-sm font-semibold">
                  อนุมัติ
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

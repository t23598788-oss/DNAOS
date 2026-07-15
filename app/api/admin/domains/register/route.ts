import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { previewDomainRegister, executeDomainRegister } from "@/gateway/domains"
import type { DomainRegistrationRequest } from "@/engines/domains/types"

// Real money, irreversible — Rule 72: preview then execute with a confirmed
// preview_token, never a single-call registration.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))

  if (body.mode === "execute") {
    if (!body.preview_token) return NextResponse.json({ error: "ขาด preview_token" }, { status: 400 })
    const result = await executeDomainRegister(body.preview_token)
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  }

  const req_: DomainRegistrationRequest = body
  if (!req_.domain || !req_.years || !req_.contact) {
    return NextResponse.json({ error: "ขาด domain, years หรือ contact" }, { status: 400 })
  }
  return NextResponse.json(previewDomainRegister(req_))
}

import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { issueSandboxToken, verifySandboxToken } from "./sandbox-token";

const headers = { "Cache-Control": "no-store" };

function response(body: object, status = 200) {
  return NextResponse.json(body, { status, headers });
}

function sandboxKey(request: NextRequest) {
  const loopback = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.get("host") ?? "");
  const key = new TextEncoder().encode(process.env.DNA_SANDBOX_SIGNING_KEY ?? "");
  return process.env.NODE_ENV === "development" && loopback && key.length >= 32 ? key : null;
}

export async function POST(request: NextRequest) {
  const key = sandboxKey(request);
  if (!key) return response({ error: "SANDBOX_UNAVAILABLE" }, 404);
  if (request.headers.get("origin") !== `http://${request.headers.get("host")}`) {
    return response({ error: "ORIGIN_REJECTED" }, 403);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response({ error: "AUTH_UNAVAILABLE" }, 503);
  }

  const account = await requireAuth();
  if (account instanceof NextResponse) return response({ error: "SIGN_IN_REQUIRED" }, account.status);

  return response(await issueSandboxToken(account.id, key), 201);
}

export async function GET(request: NextRequest) {
  const key = sandboxKey(request);
  if (!key) return response({ error: "SANDBOX_UNAVAILABLE" }, 404);

  const result = await verifySandboxToken(request.headers.get("x-dna-token") ?? "", key);
  return result
    ? response({ ok: true, environment: "sandbox", ...result })
    : response({ error: "INVALID_SANDBOX_TOKEN" }, 401);
}

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import {
  deleteSystemVaultSecret,
  listSystemVaultMetadata,
  SYSTEM_VAULT_SECRET_NAMES,
  writeSystemVaultSecret,
  type SystemVaultSecretName,
} from "@/services/system-graph/systemVault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 12 * 1024;
const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function isSecretName(value: unknown): value is SystemVaultSecretName {
  return typeof value === "string" && (SYSTEM_VAULT_SECRET_NAMES as readonly string[]).includes(value);
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && parsed.protocol === `${proto}:`;
  } catch {
    return false;
  }
}

function validValue(name: SystemVaultSecretName, value: unknown): value is string {
  if (typeof value !== "string" || value.length < 8 || value.length > 8192 || value.trim() !== value) return false;
  if (name === "neo4j_connection_uri") {
    try {
      const url = new URL(value);
      return ["neo4j:", "neo4j+s:", "bolt:", "bolt+s:"].includes(url.protocol)
        && Boolean(url.hostname)
        && !url.username
        && !url.password
        && !url.search
        && !url.hash;
    } catch {
      return false;
    }
  }
  return value.length >= 20;
}

function unavailable() {
  return NextResponse.json(
    { ok: false, code: "SYSTEM_VAULT_UNAVAILABLE", message: "ฐานระบบยังไม่ได้ตั้งค่าหรือยังไม่ได้ติดตั้ง migration" },
    { status: 503, headers: NO_STORE },
  );
}

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  try {
    const secrets = await listSystemVaultMetadata();
    return NextResponse.json({ ok: true, secrets }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, code: "ORIGIN_REJECTED" }, { status: 403, headers: NO_STORE });
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return NextResponse.json({ ok: false, code: "BODY_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return NextResponse.json({ ok: false, code: "BODY_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  let body: { secret_name?: unknown; secret_value?: unknown };
  try { body = JSON.parse(raw) as typeof body; } catch { return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  if (!isSecretName(body.secret_name) || !validValue(body.secret_name, body.secret_value)) {
    return NextResponse.json({ ok: false, code: "INVALID_SECRET_INPUT" }, { status: 400, headers: NO_STORE });
  }
  try {
    const secret = await writeSystemVaultSecret(body.secret_name, body.secret_value, auth.id);
    return NextResponse.json({ ok: true, secret }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, code: "ORIGIN_REJECTED" }, { status: 403, headers: NO_STORE });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 1024) return NextResponse.json({ ok: false, code: "BODY_TOO_LARGE" }, { status: 413, headers: NO_STORE });
  let body: { secret_name?: unknown };
  try { body = JSON.parse(raw) as typeof body; } catch { return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400, headers: NO_STORE }); }
  if (!isSecretName(body.secret_name)) return NextResponse.json({ ok: false, code: "INVALID_SECRET_NAME" }, { status: 400, headers: NO_STORE });
  try {
    await deleteSystemVaultSecret(body.secret_name);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return unavailable();
  }
}

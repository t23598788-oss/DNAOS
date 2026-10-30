import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_MAX_AGE } from "@/services/supabase/browser";
import { supabaseAdmin } from "@/services/supabase/queries";
import { isSafeInternalPath } from "@/core/auth/resolveDestination";

// THE single authentication entry for emailed links (promoted from "backup
// path" by the owner's one-flow directive, 2026-09-24): /login sends a
// Supabase magic link (signInWithOtp), the click lands HERE with token_hash +
// type (magiclink | recovery | signup | …), verifyOtp sets the session
// server-side, then redirects through the SAME isSafeInternalPath ?next=
// guard → /app role-bounce → workspace. Recovery uses this identical route —
// one flow, one way in.

// M030 (2026-10-31) session fix: this route writes its OWN response
// (`new NextResponse(...)` redirect below — relative Location headers, see the
// note further down), so the generic cookies()-store client in
// services/supabase/server.ts is NOT in play here — its writes land in the
// framework's implicit response, never in the one we return, and the brand-new
// session was silently dropped on the way out (real Playwright proof: confirm
// returned 307 → /account/change-password?first=1 yet every protected page
// saw NO session and bounced to /login?next=…). The adapter pattern that
// middleware.ts already uses is applied here instead: the Supabase client
// writes directly onto the response we actually return, so the cookies the
// toolkit sets during verifyOtp reach this exact 307 response.
function makeConfirmClient(req: NextRequest, resp: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { maxAge: SESSION_COOKIE_MAX_AGE },
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            resp.cookies.set(name, value, options)
          );
        },
      },
    }
  );
}

// Per-IP sliding-window limiter against token_hash brute-forcing (TASK-001,
// DNA-000072). In-memory only — resets per server instance, not shared across
// serverless regions/cold-starts, so this is defense-in-depth on top of
// Supabase's own token expiry/single-use enforcement, not a hard guarantee.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const failuresByIp = new Map<string, number[]>();

// Failure-only sliding window (fix, 2026-09-24): the OLD limiter pushed a
// timestamp on EVERY /auth/confirm hit — including a user's own VALID link
// clicks — so anyone who touched the endpoint 5+ times in 10 minutes (one
// real Owner run was 10 attempts) got bounced to ?error=too_many_attempts
// even with a perfectly valid link, and the old login page showed NO error
// for it (silent lockout). Now only FAILED verifications count, and a
// success clears the bucket. Supabase still enforces token expiry/single-use
// server-side — this stays defense-in-depth only.
function pruneFailures(ip: string): number[] {
  const now = Date.now();
  const list = (failuresByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  failuresByIp.set(ip, list);
  return list;
}
function isRateLimited(ip: string): boolean {
  return pruneFailures(ip).length > MAX_ATTEMPTS;
}
function recordFailure(ip: string): void {
  const list = pruneFailures(ip);
  list.push(Date.now());
  failuresByIp.set(ip, list);
}
function clearFailures(ip: string): void {
  failuresByIp.delete(ip);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code"); // PKCE return from provider OAuth (Google/Apple/Microsoft)
  const providerError = searchParams.get("error"); // provider denied / not configured in Dashboard
  const next = searchParams.get("next") ?? "/app";
  // ?next= is attacker-controllable: `new URL("//evil.com", origin)` resolves
  // to https://evil.com (protocol-relative). Guard through the SAME
  // isSafeInternalPath authority resolveDestination uses; unsafe → default.
  const safeNext = isSafeInternalPath(next) ? next : "/app"; // /app = role-bounce entry (PWA start_url)

  // M030: one response the Supabase client can write session cookies onto,
  // even when the outcome of this route turns out to be a redirect.
  const cookieCarrier = NextResponse.next({ request: { headers: new Headers(req.headers) } });
  const supabase = makeConfirmClient(req, cookieCarrier);

  // REDIRECTS SEND A RELATIVE Location HEADER DIRECTLY (owner fix 2026-10-08,
  // found by real browser login test on Railway): `new URL(req.url).origin`
  // inside the container is http://localhost:8080 (the proxy forwards the
  // internal host), so absolute redirects built from it sent the browser to
  // localhost — a guaranteed broken hosted login. And NextResponse.redirect()
  // rejects relative URLs outright ("middleware-relative-urls"), so we emit a
  // raw 307 with a relative Location and let the BROWSER resolve it against
  // the host the user is actually on. The ?next= safety guard is unchanged.
  // M030: whatever cookies the Supabase client wrote during verifyOtp are
  // copied from cookieCarrier onto this exact response, so the redirect never
  // travels without the session.
  const redirectTo = (location: string): NextResponse => {
    const out = new NextResponse(null, {
      status: 307,
      headers: { Location: location },
    });
    for (const cookie of cookieCarrier.headers.getSetCookie()) {
      out.headers.append("set-cookie", cookie);
    }
    return out;
  };

  if (providerError) {
    const errorCode = searchParams.get("error_code");
    const params = new URLSearchParams({
      error: errorCode === "otp_expired" ? "invalid_link" : "oauth_denied",
      next: safeNext,
    });
    return redirectTo(`/login?${params.toString()}`);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return redirectTo("/login?error=too_many_attempts");
  }

  // Provider OAuth (PKCE return from Google/Apple/Microsoft): SAME one
  // verifier entry — exchange the code, then the identical safe-next redirect.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      recordFailure(ip);
      return redirectTo("/login?error=invalid_link");
    }
    clearFailures(ip);
    return redirectTo(safeNext);
  }

  if (!tokenHash || !type) {
    // Nothing was guessed here (no oracle) — redirect WITHOUT counting.
    return redirectTo("/login?error=invalid_link");
  }

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    recordFailure(ip);
    return redirectTo("/login?error=invalid_link");
  }
  clearFailures(ip);

  // M030 (2026-10-31): a verified session routes through the SAME landing
  // rules — no second verifier, no new auth system.
  //   - recovery link → set a NEW password first (the session is real but
  //     the password is unknown) at the existing /account/change-password
  //   - magic-link/sign-up user with no stored password → ONE stop at
  //     first-time setup (same page; the password is set via Supabase Auth
  //     API; we record only a timestamp)
  //   - everyone already carrying a password lands on safeNext exactly as
  //     before, so nobody is bounced into setup twice.
  // The marker is profiles.password_set_at (timestamp only — no password or
  // hash is ever stored in this database).
  const verifiedUser = data.user;
  if (verifiedUser) {
    const nextSuffix =
      safeNext && safeNext !== "/app" ? `&next=${encodeURIComponent(safeNext)}` : "";
    if (type === "recovery") {
      return redirectTo(`/account/change-password?recovery=1${nextSuffix}`);
    }
    const { data: profile } = await supabaseAdmin()
      .from("profiles")
      .select("password_set_at")
      .eq("id", verifiedUser.id)
      .maybeSingle();
    if (!profile?.password_set_at) {
      return redirectTo(`/account/change-password?first=1${nextSuffix}`);
    }
  }
  return redirectTo(safeNext);
}

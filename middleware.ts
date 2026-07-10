import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_MAX_AGE } from "@/services/supabase/browser";

// TASK-001 (SSO): coarse "must be authenticated" gate + Supabase session
// refresh, for every Portal and every protected API route — not just
// /admin/* like before. Fine-grained ROLE checks (e.g. "must be admin, not
// customer") happen one layer down, in core/auth/requireAuth (API routes)
// and core/auth/requireAuthPage (Server Component layouts/pages), both
// reading registry/permissions.json — kept out of middleware so this file
// never needs a DB round trip per request, just a JWT check + refresh.
const PROTECTED_PAGE_PREFIXES = ["/admin", "/business", "/user", "/partner"];
const PROTECTED_API_PREFIXES = ["/api/admin", "/api/document", "/api/action", "/api/explain"];
const PAGE_EXEMPTIONS = ["/admin/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { maxAge: SESSION_COOKIE_MAX_AGE },
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Also refreshes the access/refresh token cookies via setAll above if the
  // access token is near expiry — this is what makes "remember login" work
  // across visits without the user re-entering a password.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  const isExempt = PAGE_EXEMPTIONS.some((p) => pathname.startsWith(p));
  const isProtectedPage = !isExempt && PROTECTED_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p));

  console.log("[TRACE-AUTH] middleware", {
    pathname,
    cookieNames: req.cookies.getAll().map((c) => c.name),
    userFound: !!user,
    userId: user?.id,
    userError: userError?.message,
    isProtectedPage,
    isProtectedApi,
  });

  if (!user && isProtectedPage) {
    console.log("[TRACE-AUTH] middleware REDIRECT to /login", { pathname, reason: "no user, protected page" });
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!user && isProtectedApi) {
    console.log("[TRACE-AUTH] middleware 401", { pathname, reason: "no user, protected api" });
    return NextResponse.json({ ok: false, error: "ต้อง login ก่อนใช้งาน" }, { status: 401 });
  }

  console.log("[TRACE-AUTH] middleware PASS", { pathname });
  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/business/:path*",
    "/user/:path*",
    "/partner/:path*",
    "/api/admin/:path*",
    "/api/document/:path*",
    "/api/action/:path*",
    "/api/explain/:path*",
  ],
};
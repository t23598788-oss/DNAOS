import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_MAX_AGE } from "@/services/supabase/browser";
import { LOCAL_UI_REVIEW_HEADER, isLocalReviewRequest } from "@/core/auth/devReviewAccess";

// TASK-001 (SSO): coarse "must be authenticated" gate + Supabase session
// refresh, for every Portal and every protected API route — not just
// /admin/* like before. Fine-grained ROLE checks (e.g. "must be admin, not
// customer") happen one layer down, in core/auth/requireAuth (API routes)
// and core/auth/requireAuthPage (Server Component layouts/pages), both
// reading registry/permissions.json — kept out of middleware so this file
// never needs a DB round trip per request, just a JWT check + refresh.
// "/business-workspace-template" (owner, 2026-09-23): DEVELOPMENT / TEMPLATE / REVIEW
// surface — not a public production business route. Adding the prefix here means
// anonymous visitors in production get the same /login redirect every other protected
// area gets; the dev-only review allowance below is what lets the Owner open it locally.
const PROTECTED_PAGE_PREFIXES = ["/admin", "/business", "/user", "/partner", "/account", "/workspace-preview", "/business-workspace-template"];
// Exact-match only, never startsWith — "/" as a PREFIX would match every
// route in the app (every pathname starts with "/"), locking out /login,
// /api/*, /liff, /oauth, everything. Root Domain UI Conversion (owner,
// 2026-08-05): "/" is now the Owner Control Center (real System
// Health/Database/Costs data, see app/page.tsx), no longer a public landing
// page — gated the same way /admin is, but scoped to exactly this one path.
const PROTECTED_EXACT_PAGES = ["/"];
const PROTECTED_API_PREFIXES = ["/api/admin", "/api/document", "/api/action", "/api/explain"];
const PAGE_EXEMPTIONS = ["/admin/login"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // LOCAL UI REVIEW (dev only) — ทำงานเฉพาะ path ที่อยู่ใน LOCAL_UI_REVIEW_PREFIXES
  // (/admin/ui-gallery และ /business-workspace-template) บน loopback ใน build ที่ไม่ใช่
  // production; คืนก่อนแตะ Supabase เลย จึงไม่กระทบเส้นทาง auth จริง และไม่พึ่ง session/credential
  //
  // header ภายในถูก strip จากทุกคำขอ (รวมคำขอที่ browser ส่งมาเอง) เพื่อไม่ให้ปลอมได้
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete(LOCAL_UI_REVIEW_HEADER);
  if (isLocalReviewRequest(pathname, req.headers.get("host"))) {
    requestHeaders.set(LOCAL_UI_REVIEW_HEADER, "1");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

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
          response = NextResponse.next({ request: { headers: requestHeaders } });
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
  //
  // Real incident (owner, 2026-07-29): a real Supabase Auth slowdown left
  // this call hanging until Vercel itself killed the request
  // (MIDDLEWARE_INVOCATION_TIMEOUT) — every single protected page 504'd,
  // not just the one request. This had no timeout at all before. Racing
  // against a timeout and failing to "not logged in" (redirect to login,
  // never silently letting a request through) keeps one slow upstream call
  // from taking down every admin/business/partner page at once.
  let user: { id: string } | null = null;
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("auth.getUser timeout")), 8000)),
    ]);
    user = result.data.user;
  } catch {
    user = null;
  }

  const isExempt = PAGE_EXEMPTIONS.some((p) => pathname.startsWith(p));
  const isProtectedPage =
    !isExempt &&
    (PROTECTED_PAGE_PREFIXES.some((p) => pathname.startsWith(p)) || PROTECTED_EXACT_PAGES.includes(pathname));
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && isProtectedPage) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!user && isProtectedApi) {
    return NextResponse.json({ ok: false, error: "ต้อง login ก่อนใช้งาน" }, { status: 401 });
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/business/:path*",
    "/user/:path*",
    "/partner/:path*",
    "/account/:path*",
    "/workspace-preview/:path*",
    "/business-workspace-template/:path*",
    "/api/admin/:path*",
    "/api/document/:path*",
    "/api/action/:path*",
    "/api/explain/:path*",
  ],
};
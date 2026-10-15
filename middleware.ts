import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_MAX_AGE } from "@/services/supabase/browser";
import { LOCAL_UI_REVIEW_HEADER, isLocalReviewRequest } from "@/core/auth/devReviewAccess";
import {
  APP_SCOPE_HEADER,
  SURFACE_COOKIE,
  appScopeForPath,
  canEnterSurface,
  decideSurfaceAction,
  decideSurfacePage,
  resolveSurface,
  surfaceForPagePath,
} from "@/core/auth/surfacePolicy";

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
const PROTECTED_PAGE_PREFIXES = ["/admin", "/business", "/user", "/partner", "/account", "/workspace-preview", "/business-workspace-template", "/developer"];
// Exact-match only, never startsWith — "/" as a PREFIX would match every
// route in the app (every pathname starts with "/"), locking out /login,
// /api/*, /liff, /oauth, everything. Root Domain UI Conversion (owner,
// 2026-08-05): "/" is now the Owner Control Center (real System
// Health/Database/Costs data, see app/page.tsx), no longer a public landing
// page — gated the same way /admin is, but scoped to exactly this one path.
const PROTECTED_EXACT_PAGES = ["/"];
const PROTECTED_API_PREFIXES = ["/api/admin", "/api/document", "/api/action", "/api/explain"];
const PAGE_EXEMPTIONS = ["/admin/login"];

/**
 * Role lookup used ONLY for a surface-switch decision (owner directive
 * 2026-10-15). Reads the same `profiles` row core/auth/session.ts already reads
 * (RLS policy `profiles_select_own` allows the caller's own row) — it is NOT a
 * second identity/session system, and it never runs for ordinary requests: only
 * when a workspace ENTRY URL is opened. Fail-closed: any error/timeout returns
 * null → the caller may NOT enter the development surface (stays operational).
 */
async function resolveSurfaceRole(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<string | null> {
  try {
    const result = (await Promise.race([
      supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("surface role timeout")), 3000)),
    ])) as { data?: { role?: string } | null };
    const role = result?.data?.role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // LOCAL UI REVIEW (dev only) — ทำงานเฉพาะ path ที่อยู่ใน LOCAL_UI_REVIEW_PREFIXES
  // (/admin/ui-gallery · /business-workspace-template · /workspace — owner approval
  // 2026-09-24) บน loopback ใน build ที่ไม่ใช่ production; คืนก่อนแตะ Supabase เลย
  // จึงไม่กระทบเส้นทาง auth จริง และไม่พึ่ง session/credential
  //
  // header ภายในถูก strip จากทุกคำขอ (รวมคำขอที่ browser ส่งมาเอง) เพื่อไม่ให้ปลอมได้
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete(LOCAL_UI_REVIEW_HEADER);
  // APP SCOPE (owner directive 2026-10-15 — strict Business ⇄ Developer
  // application separation): stamp which application this page belongs to,
  // computed from the same registry, so the Server Component layout can refuse
  // to render the OTHER app's navigation/icons. A client-supplied copy is
  // stripped first and never trusted (same discipline as the review header).
  requestHeaders.delete(APP_SCOPE_HEADER);
  requestHeaders.set(APP_SCOPE_HEADER, appScopeForPath(pathname));
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

  // ── CONTROL SURFACE ENFORCEMENT (owner directive 2026-10-12, extended 2026-10-15) ──
  // ยุติแผนแยก source แบบตัดความสัมพันธ์ — แยกแค่ CONTROL SURFACE ที่ runtime จริง:
  //  (1) Business surface สั่ง developer-plane action ไม่ได้ (source.modify / git.push /
  //      deployment.execute / developer.worker.execute / developer.workflow.execute)
  //  (2) owner directive 2026-10-15: developer-plane READ (Source Code, Git Status,
  //      Infrastructure) ถูกปิด **ทุก HTTP method รวม GET/HEAD** สำหรับ Business surface
  //  (3) owner directive 2026-10-15: หน้า Developer/Infrastructure ปิดที่ server (404)
  //      สำหรับ Business surface — ทั้งเปิด URL ตรงและผ่านเมนู
  //  Policy อ่านจาก registry/permissions.json#capability_actions ที่เดียว ผ่าน
  //  core/auth/surfacePolicy.ts (fail-closed: ไม่มี/ค่าผิด = operational)
  //  สาย developer ยังเดินเข้า requireAuth + fsSecurity + review/build/deploy-gate
  //  ของเดิมทุกชั้น — ไม่มี gate ใหม่ถูกสร้างแทนของเดิม
  const surface = resolveSurface(req.cookies.get(SURFACE_COOKIE)?.value);
  const isPageNavigation =
    req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html");

  if (isProtectedApi) {
    const decision = decideSurfaceAction({ pathname, method: req.method, surface });
    if (!decision.allowed) {
      return NextResponse.json(
        {
          ok: false,
          code: decision.code ?? "SURFACE_ACTION_DENIED",
          action: decision.action,
          surface: decision.surface,
          error: decision.reason,
        },
        { status: 403 },
      );
    }
  }

  if (isPageNavigation) {
    // ── SURFACE SWITCH — เฉพาะการเปิดหน้า workspace เท่านั้น ───────────────
    // Page navigation ไปยัง entry URL เท่านั้นที่สลับ surface (api call ไม่มีวัน
    // mint surface ของตัวเอง) · httpOnly เพื่อไม่ให้ script ฝั่ง clientเขียนเอง
    // owner directive 2026-10-15: สลับเข้า development surface ได้เฉพาะ role ที่
    // registry อนุญาต (surfaces.development.roles) — role อื่นถูกปฏิเสธแบบ
    // fail-closed (อ่าน role ไม่ได้ = ไม่อนุญาต) จึงเรียก developer API ไม่ได้เลย
    const writeSurfaceCookie = (value: "operational" | "development") =>
      response.cookies.set(SURFACE_COOKIE, value, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12,
        secure: process.env.NODE_ENV === "production",
      });
    const mayEnterDevelopment = async () =>
      !!user && canEnterSurface(await resolveSurfaceRole(supabase, user.id), "development");

    // (3) PAGE deny — server-side, ก่อนถึง layout/page ของ route นั้น.
    // ยกเว้นเดียว: role ที่ registry อนุญาตให้เข้า development surface (เช่น
    // เจ้าของ/super_admin เปิด /admin/ide ตรง ๆ) → สลับ surface ให้แล้วไปต่อ
    // ไม่ต้องอ้อมผ่าน /developer ก่อน · role อื่นเจอ 404
    const pageDecision = decideSurfacePage({ pathname, surface });
    if (!pageDecision.allowed) {
      if (!(await mayEnterDevelopment())) {
        return new NextResponse(null, { status: 404 });
      }
      writeSurfaceCookie("development");
    } else {
      const targetSurface = surfaceForPagePath(pathname);
      if (targetSurface && req.cookies.get(SURFACE_COOKIE)?.value !== targetSurface) {
        const mayEnter = targetSurface === "operational" ? true : await mayEnterDevelopment();
        if (mayEnter) writeSurfaceCookie(targetSurface);
      }
    }
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
    // DEVELOPER WORKSPACE (owner directive 2026-10-12) — URL แยกจาก Business,
    // ต้องผ่าน gate หน้า (requireAuthPage ใน layout) และเป็น entry ที่สลับ
    // surface เป็น development
    "/developer/:path*",
    // /workspace (owner approval 2026-09-24): middleware ต้องรันเพื่อ strip header
    // ปลอมจากทุกคำขอ และติด LOCAL_UI_REVIEW_HEADER เฉพาะ dev+loopback เท่านั้น
    // (ตัวหน้าเองยังกัน anonymous ด้วย getAuthedUser ใน page — ไม่ได้เพิ่ม prefix
    // เข้า PROTECTED_PAGE_PREFIXES จึงไม่มีพฤติกรรม redirect ใหม่)
    "/workspace",
    "/api/admin/:path*",
    "/api/document/:path*",
    "/api/action/:path*",
    "/api/explain/:path*",
  ],
};
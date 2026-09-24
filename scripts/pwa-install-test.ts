/**
 * pwa-install-test.ts — install/update path integrity (2026-09-24).
 * Source+filesystem truth: manifest fields & icons exist, /app bounce uses the
 * landing authority, sw.js caches ONLY immutable statics (never API/HTML →
 * no stale UI, no cross-account cache), registration + human-triggered update
 * banner wired, install help reachable. PASS/FAIL; exit 1 on any FAIL.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import permissions from "../registry/permissions.json";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── manifest + icons ────────────────────────────────────────────────────────
const manifest = JSON.parse(read("public/manifest.json"));
check("manifest.start_url = role bounce /app (not an /admin hard-route)",
  manifest.start_url === "/app");
check("manifest.scope=/ covers start_url, display standalone",
  manifest.scope === "/" && manifest.display === "standalone");
const iconsOk = (manifest.icons as { src: string }[]).every((i) => existsSync(join(ROOT, "public", i.src)));
check("manifest icons exist on disk (192+512)", iconsOk && (manifest.icons?.length ?? 0) >= 2);
check("layout links manifest + apple-touch-icon + theme-color",
  (() => {
    const l = read("app/layout.tsx");
    return l.includes('manifest: "/manifest.json"') && l.includes("apple-touch-icon") && l.includes("theme-color");
  })());

// ── /app bounce: role-authoritative, existing authorities only ──────────────
const appPage = read("app/app/page.tsx");
check("/app uses getAuthedUser + resolveDestination (no second auth)",
  appPage.includes("getAuthedUser") && appPage.includes("resolveDestination(user.role, null)"));
check("/app anonymous → /login?next=/app round-trip",
  appPage.includes('redirect("/login?next=/app")'));

// ── service worker: static-only caching, human-triggered updates ────────────
const sw = read("public/sw.js");
check("sw exists + versioned cache + SKIP_WAITING protocol",
  sw.includes("dnaos-static-") && sw.includes('event.data === "SKIP_WAITING"'));
check("sw caches ONLY static prefixes (network everything else = HTML/API/auth)",
  sw.includes('"/_next/static/"') && sw.includes('if (!isStaticPath(url.pathname)) return;') && !sw.includes('"/api'));
check("sw never caches POST + only same-origin", sw.includes('req.method !== "GET"') && sw.includes("url.origin !== self.location.origin"));
check("sw activate cleans old dnaos-static-* caches (no stuck old UI)",
  sw.includes('k.startsWith("dnaos-static-")') && sw.includes("clients.claim"));
check("sw bounds cache size (deploys can't grow forever)", sw.includes("keys.length > 300"));

const reg = read("components/pwa/PwaRegistration.tsx");
check("registration mounted in root layout", read("app/layout.tsx").includes("<PwaRegistration />"));
check("update banner exists + reload ONLY on human click",
  reg.includes("มีเวอร์ชันใหม่") && reg.includes("onClick={() => waiting.postMessage(\"SKIP_WAITING\")}"));
check("banner warns drafts will be lost on refresh (honest)",
  reg.includes("ร่างที่ยังไม่ได้บันทึก") || reg.includes("ร่างนั้นจะหาย"));
check("first-install never force-reloads (hadController guard)",
  reg.includes("hadController"));

// ── install help + registry truth ───────────────────────────────────────────
check("/install help page exists (per-device steps + web fallback)",
  existsSync(join(ROOT, "app/install/page.tsx")) && read("app/install/page.tsx").includes("เพิ่มไปยังหน้าจอโฮม"));
check("login page links to /install", read("app/login/page.tsx").includes('href="/install"'));
check("permissions.public_routes documents /install",
  (permissions.public_routes as string[]).includes("/install"));

console.log(`\npwa-install: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);

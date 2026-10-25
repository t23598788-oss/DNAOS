/**
 * GET /api/workspace/embed-check?url=… — "เว็บไซต์นี้ยอมให้ฝังใน Workspace ไหม"
 *
 * WORKSPACE TAB BAR (owner 2026-10-18): แท็บของเว็บไซต์ภายนอกต้องเป็น "หน้าจอเว็บไซต์จริง"
 * เมื่อเจ้าของเว็บอนุญาตให้ฝัง และต้องไม่สร้างหน้าเลียนแบบเมื่อถูกห้าม ⇒ ต้องรู้คำตอบจาก
 * header จริงของผู้ให้บริการ (X-Frame-Options / CSP frame-ancestors) ไม่ใช่การเดาในเบราว์เซอร์
 * (เบราว์เซอร์อ่าน header ของ cross-origin iframe ไม่ได้ จึงตอบไม่ได้ว่าโดนบล็อกหรือโหลดช้า)
 *
 * READ-ONLY: ดึงเฉพาะ header ไม่ส่ง body กลับ ไม่แตะ DB / Connect Registry / engine ใด ๆ
 * SSRF guard: http(s) เท่านั้น · ไม่รับ URL ที่มี credentials · resolve DNS แล้วปฏิเสธ
 * loopback/private/link-local/multicast · ตาม redirect เองทีละ hop (สูงสุด 3) และตรวจซ้ำทุก hop
 * (หมายเหตุ: ยังเหลือ DNS-rebinding window ตามธรรมชาติของการ resolve ก่อน fetch — ยอมรับใน
 * dev tool นี้ เพราะ response ไม่มีข้อมูลภายในระบบกลับไป มีเพียง boolean + เหตุผลเชิง header)
 */
import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const dynamic = "force-dynamic";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 6000;
const USER_AGENT = "DNA-OS-Embed-Check/1.0 (+workspace tab bar)";

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd");
}

function isBlockedAddress(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** คืน URL ที่ผ่าน guard หรือ null — ไม่คืนเหตุผลละเอียดเพื่อไม่เป็น oracle ให้ผู้เรียก */
async function allowedUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return null;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (isIP(host)) return isBlockedAddress(host) ? null : url;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return null;
  }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) return null;
  return url;
}

/** ตัดสินจากการ header จริงเท่านั้น — ไม่มีรายการ "เว็บที่เดาว่าห้าม" ในโค้ด */
function frameDecision(
  headers: Headers,
  finalUrl: URL,
  selfOrigin: string,
): { embeddable: boolean; reason: string } {
  const csp = headers.get("content-security-policy") ?? "";
  const ancestors = /(?:^|;)\s*frame-ancestors([^;]*)/i.exec(csp)?.[1]?.trim().toLowerCase();
  if (ancestors) {
    const tokens = ancestors.split(/\s+/).filter(Boolean);
    const self = selfOrigin.toLowerCase();
    const allowed = tokens.some(
      (token) =>
        token === "*" ||
        token === "https:" ||
        token === "http:" ||
        token === self ||
        token === finalUrl.origin.toLowerCase(),
    );
    return allowed
      ? { embeddable: true, reason: "csp_frame_ancestors_allow" }
      : { embeddable: false, reason: "csp_frame_ancestors_block" };
  }

  const xfo = (headers.get("x-frame-options") ?? "").toLowerCase();
  if (xfo.includes("deny")) return { embeddable: false, reason: "x_frame_options_deny" };
  if (xfo.includes("sameorigin")) return { embeddable: false, reason: "x_frame_options_sameorigin" };
  if (xfo.includes("allow-from")) return { embeddable: false, reason: "x_frame_options_allow_from" };

  return { embeddable: true, reason: "no_frame_restriction" };
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!raw) return NextResponse.json({ ok: false, embeddable: false, reason: "missing_url" }, { status: 400 });

  let current = await allowedUrl(raw);
  if (!current) return NextResponse.json({ ok: false, embeddable: false, reason: "url_not_allowed" }, { status: 400 });

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return NextResponse.json({ ok: false, embeddable: false, reason: "unreachable", url: current.toString() });
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      void response.body?.cancel().catch(() => {});
      if (!location) return NextResponse.json({ ok: false, embeddable: false, reason: "redirect_without_location", url: current.toString() });
      const next = await allowedUrl(new URL(location, current).toString());
      if (!next) return NextResponse.json({ ok: false, embeddable: false, reason: "redirect_not_allowed", url: current.toString() });
      current = next;
      continue;
    }

    const decision = frameDecision(response.headers, current, request.nextUrl.origin);
    void response.body?.cancel().catch(() => {});
    return NextResponse.json({
      ok: true,
      url: current.toString(),
      status: response.status,
      embeddable: decision.embeddable,
      reason: decision.reason,
    });
  }

  return NextResponse.json({ ok: false, embeddable: false, reason: "too_many_redirects", url: current.toString() });
}

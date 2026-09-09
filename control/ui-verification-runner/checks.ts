/**
 * หน้าที่: ชุดตรวจหน้าจอแบบกำหนดผลได้ ทุกข้อเทียบ "ค่าที่เบราว์เซอร์คืนมา"
 * กับ "ค่าที่คาดไว้" ตรง ๆ ไม่มีการอ่านภาพ ไม่มีการตีความข้อความของ Agent
 *
 * Owner, 2026-09-05: screenshot เป็นหลักฐานให้คนดู ไม่ใช่ที่มาของ status
 * ทุกฟังก์ชันที่นี่จึงคืน `observed_machine_value` เป็นตัวเลข/พิกัด/รายการ
 * และ `status` มาจากการเทียบเชิงกลเท่านั้น
 *
 * Input: Session (control/ui-verification-runner/cdp.ts) และ route
 * Output: Check[] ตาม ./types.ts
 * Dependency ที่อนุญาต: ./cdp.ts, ./types.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ฟังก์ชันใดคืน PASS โดยไม่มีค่าที่วัดได้จริงประกอบ
 * - ห้ามใช้ screenshot ตัดสิน
 * - วัดไม่ได้ต้องเป็น BLOCKED ไม่ใช่ PASS (ไม่มีหลักฐาน ≠ ผ่าน)
 */

import { findSurface } from "../system-map/contract";
import type { Session } from "./cdp";
import type { Check, CheckStatus, CheckType } from "./types";

/** ตัวช่วยประกอบผล — reason ต้องอธิบายการเทียบเสมอ ไม่ใช่ความเห็น */
function check(
  check_id: string, check_type: CheckType, route: string,
  expected: string, observed_machine_value: unknown, status: CheckStatus,
  reason: string, evidence_pointer: string | null = null,
): Check {
  return { check_id, check_type, route, expected, observed_machine_value, status, reason, evidence_pointer };
}

/** พื้นที่ทับซ้อนของสองกล่อง — 0 แปลว่าไม่ทับกัน */
const INTERSECTION_JS = `
(() => {
  const box = (sel) => { const el = document.querySelector(sel); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const identity = box('.brand') || box('.brand-text');
  const headingEl = [...document.querySelectorAll('.stage h1, .stage h2')].find((e) => e.offsetParent !== null) || null;
  const heading = headingEl ? (() => { const r = headingEl.getBoundingClientRect();
    return { sel: 'stage-heading', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() : null;
  if (!identity || !heading) return { identity, heading, intersection_area: null };
  const ox = Math.max(0, Math.min(identity.x + identity.w, heading.x + heading.w) - Math.max(identity.x, heading.x));
  const oy = Math.max(0, Math.min(identity.y + identity.h, heading.y + heading.h) - Math.max(identity.y, heading.y));
  return { identity, heading, intersection_area: ox * oy };
})()`;

/** นับ node ที่ "มองเห็นได้จริง" ซึ่งทำหน้าที่เป็นหัวข้อของ route */
const HEADING_COUNT_JS = `
(() => {
  const visible = (el) => { if (!el) return false; const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const stage = [...document.querySelectorAll('.stage h1, .stage h2')].filter(visible);
  const chrome = [...document.querySelectorAll('.view-name')].filter(visible);
  const text = (e) => (e.textContent || '').trim();
  return { stage_headings: stage.map(text), chrome_headings: chrome.map(text),
           visible_route_heading_count: stage.length + chrome.length };
})()`;

/** อ่านเส้นคั่นแนวนอนด้านบนจาก computed style จริง ไม่ใช่จากไฟล์ CSS */
const TOP_DIVIDER_JS = `
(() => {
  const el = document.querySelector('.topbar');
  if (!el) return { present: false, reason: 'no .topbar element in this route' };
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const rendered = s.display !== 'none' && s.visibility !== 'hidden' && r.height > 0;
  const bw = parseFloat(s.borderBottomWidth) || 0;
  return { present: rendered && bw > 0, rendered, border_bottom_width: bw,
           border_bottom_color: s.borderBottomColor, background: s.backgroundColor,
           height: Math.round(r.height) };
})()`;

/** แถบซ้ายที่ถูกทาสีถาวร — วัดจาก computed background ของ .sidebar เอง */
const COLLAPSED_RAIL_JS = `
(() => {
  const el = document.querySelector('.sidebar');
  if (!el) return { painted: false, reason: 'no .sidebar element' };
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const bg = s.backgroundColor;
  const transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
  const visible = [...el.querySelectorAll('*')].filter((n) => { const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const b = n.getBoundingClientRect(); return b.width > 0 && b.height > 0; })
    .map((n) => (n.className && typeof n.className === 'string' ? n.className.split(' ')[0] : n.tagName.toLowerCase()));
  return { painted: !transparent, background: bg, width: Math.round(r.width), height: Math.round(r.height),
           viewport_height: window.innerHeight, full_height: Math.round(r.height) >= window.innerHeight - 2,
           visible_descendant_classes: [...new Set(visible)].slice(0, 20) };
})()`;

export async function checkRouteLoad(s: Session, route: string, url: string): Promise<Check> {
  const v = await s.evaluate<{ ready: string; title: string; body_len: number }>(
    `({ ready: document.readyState, title: document.title, body_len: document.body ? document.body.innerHTML.length : 0 })`);
  const ok = v.ready === "complete" && v.body_len > 0;
  return check(`ROUTE_LOAD:${route}`, "ROUTE_LOAD", route, "readyState=complete และมีเนื้อหาใน body",
    v, ok ? "PASS" : "FAIL", ok ? `readyState=${v.ready} body ${v.body_len} ตัวอักษร` : `หน้าไม่พร้อม: readyState=${v.ready} body=${v.body_len}`, url);
}

/**
 * จำนวนหัวข้อที่ถูกต้องมาจากแผนที่ ไม่ใช่ค่าคงที่ และไม่ใช่คำตัดสินของ Owner
 *
 * เดิมตรึงไว้ที่ 1 ทุก route ซึ่งทำให้ /#command ตกทั้งที่ออกแบบเป็น full-canvas
 * ไม่มีหัวข้อ แล้วผู้ตรวจก็ไปถาม Owner ว่าจะยกเว้นไหม — ผิดตามข้อ 11 ของ Owner
 * (2026-09-05) คำตอบอยู่ใน source อยู่แล้ว ที่ของมันคือ control/system-map/
 * route ที่ไม่อยู่ในแผนที่ = ตรวจไม่ได้ = BLOCKED ไม่ใช่เดาว่า 1
 */
export async function checkDuplicatedHeading(s: Session, route: string): Promise<Check> {
  const v = await s.evaluate<{ stage_headings: string[]; chrome_headings: string[]; visible_route_heading_count: number }>(HEADING_COUNT_JS);
  const surface = findSurface(route);
  if (surface === null) {
    return check(`DUPLICATED_HEADING:${route}`, "DUPLICATED_HEADING", route,
      "จำนวนหัวข้อตามที่แผนที่ประกาศ", { ...v, expected: null }, "BLOCKED",
      `route "${route}" ไม่อยู่ใน control/system-map/ จึงไม่มีค่าคาดหวังที่อ้างอิงได้`);
  }
  const expected = surface.expected_visible_heading_count;
  const ok = v.visible_route_heading_count === expected;
  return check(`DUPLICATED_HEADING:${route}`, "DUPLICATED_HEADING", route,
    `จำนวนหัวข้อ route ที่มองเห็นได้ = ${expected} (แผนที่: ${surface.evidence[0]})`,
    { ...v, expected }, ok ? "PASS" : "FAIL",
    ok ? `นับได้ ${v.visible_route_heading_count} ตรงกับแผนที่: ${JSON.stringify(v.stage_headings)}`
       : `นับได้ ${v.visible_route_heading_count} แต่แผนที่ประกาศ ${expected} — content=${JSON.stringify(v.stage_headings)} chrome=${JSON.stringify(v.chrome_headings)}`);
}

export async function checkTopDivider(s: Session, route: string): Promise<Check> {
  const v = await s.evaluate<{ present: boolean; border_bottom_width?: number }>(TOP_DIVIDER_JS);
  const ok = v.present === false;
  return check(`TOP_DIVIDER_PRESENT:${route}`, "TOP_DIVIDER_PRESENT", route, "ไม่มีเส้นคั่นแนวนอนด้านบน (border-bottom = 0 หรือ topbar ไม่ถูกเรนเดอร์)",
    v, ok ? "PASS" : "FAIL", ok ? "ไม่พบเส้นคั่นที่เรนเดอร์จริง" : `พบเส้นคั่น border-bottom = ${v.border_bottom_width}px`);
}

export async function checkOverlapGeometry(s: Session, route: string): Promise<Check> {
  const v = await s.evaluate<{ identity: unknown; heading: unknown; intersection_area: number | null }>(INTERSECTION_JS);
  if (v.intersection_area === null) {
    /**
     * ไม่มีหัวข้อให้วัด — ต้องแยกสองกรณีจากแผนที่ ไม่ใช่ตอบ BLOCKED เหมือนกันหมด
     * ถ้าแผนที่ประกาศว่า route นี้ไม่มีหัวข้อ (เช่น full-canvas) การไม่มีพื้นที่
     * ทับซ้อนเป็นข้อเท็จจริงที่พิสูจน์แล้ว ไม่ใช่การวัดไม่ได้
     */
    const surface = findSurface(route);
    if (surface !== null && surface.expected_visible_heading_count === 0) {
      return check(`OVERLAP_GEOMETRY:${route}`, "OVERLAP_GEOMETRY", route,
        "พื้นที่ทับซ้อน = 0 (แผนที่ประกาศว่า route นี้ไม่มีหัวข้อ)", { ...v, expected_heading_count: 0 }, "PASS",
        "ไม่มีหัวข้อตามที่แผนที่ประกาศ จึงทับซ้อนไม่ได้");
    }
    return check(`OVERLAP_GEOMETRY:${route}`, "OVERLAP_GEOMETRY", route, "พื้นที่ทับซ้อนระหว่างบล็อกตัวตนกับหัวข้อ route = 0",
      v, "BLOCKED", "วัดไม่ได้: หาบล็อกตัวตนหรือหัวข้อที่มองเห็นได้ไม่ครบ");
  }
  const ok = v.intersection_area === 0;
  return check(`OVERLAP_GEOMETRY:${route}`, "OVERLAP_GEOMETRY", route, "พื้นที่ทับซ้อน = 0",
    v, ok ? "PASS" : "FAIL", ok ? "ไม่ทับกัน" : `ทับกัน ${v.intersection_area} ตารางพิกเซล`);
}

export async function checkCollapsedRail(s: Session, route: string): Promise<Check> {
  const v = await s.evaluate<{ painted: boolean; background?: string; full_height?: boolean; visible_descendant_classes?: string[] }>(COLLAPSED_RAIL_JS);
  const ok = v.painted === false;
  return check(`COLLAPSED_NAV_GEOMETRY:${route}`, "COLLAPSED_NAV_GEOMETRY", route, "แถบข้างตอนยุบต้องไม่ถูกทาสีถาวร (background โปร่งใส)",
    v, ok ? "PASS" : "FAIL", ok ? `background=${v.background} โปร่งใส` : `ถูกทาสี background=${v.background} เต็มความสูง=${v.full_height}`);
}

export function checkConsoleErrors(s: Session, route: string, allowlist: readonly string[]): Check {
  const errors = s.consoleErrors().filter((e) => !allowlist.some((a) => e.text.includes(a)));
  const ok = errors.length === 0;
  return check(`CONSOLE_ERRORS:${route}`, "CONSOLE_ERRORS", route, "console error = 0 (นอกรายการยกเว้น)",
    { count: errors.length, entries: errors.slice(0, 8) }, ok ? "PASS" : "FAIL",
    ok ? "ไม่มี console error" : `พบ ${errors.length} รายการ`);
}

export function checkNetworkErrors(s: Session, route: string, allowlist: readonly string[]): Check {
  const failures = s.networkFailures().filter((f) => !allowlist.some((a) => f.url.includes(a)));
  const ok = failures.length === 0;
  return check(`NETWORK_ERRORS:${route}`, "NETWORK_ERRORS", route, "คำขอที่ล้มเหลว = 0 (นอกรายการยกเว้น)",
    { count: failures.length, failures: failures.slice(0, 8) }, ok ? "PASS" : "FAIL",
    ok ? "ไม่มีคำขอที่ล้มเหลว" : `ล้มเหลว ${failures.length} รายการ`);
}

/**
 * ไป route A แล้วไป B — เครื่องหมายเฉพาะของ A ต้องหายไปหลัง B วาดเสร็จ
 * เครื่องหมายที่ใช้คือข้อความหัวข้อของ A ซึ่งอ่านจากหน้าจริง ไม่ได้ตั้งเอง
 */
export async function checkStaleRouteContent(s: Session, base: string, routeA: string, routeB: string): Promise<Check> {
  await s.navigate(`${base}${routeA}`);
  const marker = await s.evaluate<string | null>(
    `(() => { const e = [...document.querySelectorAll('.stage h1, .stage h2')].find((n) => n.offsetParent !== null); return e ? (e.textContent || '').trim() : null; })()`);
  if (marker === null || marker === "") {
    // route ที่แผนที่ประกาศว่าไม่มีหัวข้อ ใช้หัวข้อเป็นเครื่องหมายไม่ได้ตั้งแต่ต้น
    // ตอบตามจริงว่าตรวจด้วยวิธีนี้ไม่ได้ ไม่ใช่แกล้งผ่าน
    return check(`STALE_ROUTE_CONTENT:${routeA}->${routeB}`, "STALE_ROUTE_CONTENT", routeB,
      `หลังเปลี่ยนไป ${routeB} ต้องไม่เหลือเครื่องหมายเฉพาะของ ${routeA}`, { marker: null }, "BLOCKED",
      `หา​เครื่องหมายเฉพาะของ ${routeA} ไม่ได้ จึงตรวจไม่ได้`);
  }
  await s.navigate(`${base}${routeB}`);
  const v = await s.evaluate<{ still_present: boolean; occurrences: number; stage_headings: string[] }>(
    `(() => { const m = ${JSON.stringify(marker)};
      const stage = [...document.querySelectorAll('.stage h1, .stage h2')].filter((e) => e.offsetParent !== null).map((e) => (e.textContent||'').trim());
      const body = document.querySelector('.stage'); const txt = body ? (body.textContent || '') : '';
      let n = 0, i = 0; while ((i = txt.indexOf(m, i)) !== -1) { n++; i += m.length; }
      return { still_present: n > 0, occurrences: n, stage_headings: stage }; })()`);
  const ok = v.still_present === false;
  return check(`STALE_ROUTE_CONTENT:${routeA}->${routeB}`, "STALE_ROUTE_CONTENT", routeB,
    `เครื่องหมาย "${marker}" ของ ${routeA} ต้องไม่เหลือใน ${routeB}`, v, ok ? "PASS" : "FAIL",
    ok ? `ไม่เหลือเครื่องหมายของ ${routeA}` : `ยังพบ "${marker}" ${v.occurrences} ครั้งหลังเปลี่ยน route`);
}

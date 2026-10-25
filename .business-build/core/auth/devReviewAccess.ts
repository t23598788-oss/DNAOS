// LOCAL UI REVIEW — dev-only allowance for Owner UI review (owner directive 2026-09-22).
//
// ขอบเขตแคบที่สุดเท่าที่ทำได้ เพื่อให้ Owner เปิดดู UI Gallery / Template บนเครื่องตัวเองได้โดยไม่ต้อง login:
//   - NODE_ENV !== "production"  → build ที่ deploy จริงไม่เข้าเส้นทางนี้เลย (fail closed)
//   - host ต้องเป็น loopback (localhost / 127.0.0.1 / [::1]) → เฉพาะเครื่องที่รัน dev server
//   - path ต้องอยู่ใต้ prefix ที่อนุญาตเท่านั้น (LOCAL_UI_REVIEW_PREFIXES) และต้องตรงทั้งหมด
//     หรือขึ้นต้นด้วย prefix + "/" (ไม่ใช่ทั้งย่าน)
//   - ไม่แตะอะไรอื่น: /login, ทุกหน้า /admin อื่น, /business|/user|/partner|/account,
//     /workspace, /workspace-preview และทุก protected API ยังใช้ middleware + requireAuthPage เดิมทุกบรรทัด
//
// นี่ไม่ใช่ระบบ auth ที่สอง — เป็น predicate เดียวที่ถูกใช้โดย guard ที่มีอยู่แล้ว
// (middleware.ts และ layout ของพื้นที่นั้น) โดยตรวจบน header ที่ middleware เป็นผู้ติดให้เท่านั้น

// Note (owner, 2026-09-23): /business-workspace-template ถูกเพิ่มเข้ามาในรายการนี้แล้ว
// เพราะเป็น DEVELOPMENT / TEMPLATE / REVIEW surface ไม่ใช่ public business route —
// production ยัง fail closed เหมือนเดิม (เงื่อนไข NODE_ENV ด้านล่างไม่เปลี่ยน)
//
// Note (owner approval, 2026-09-24): /workspace ถูกเพิ่มเข้ามาตามคำอนุมัติของ Owner
// (เปิดดูหน้าจอ workspace บนเครื่องตัวเองได้โดยไม่ต้อง login) — เฉพาะเปลือก UI:
// ไม่มี session · ไม่มี role · ไม่ query ข้อมูลธุรกิจ · ไม่มี Settings และทุก route
// ที่อยู่หลังเครื่องมือยังมี server guard ของตัวเองเหมือนเดิมทุกบรรทัด

/** prefix ที่อนุญาตให้ review แบบ dev — ต้องตรงทั้งหมดหรือขึ้นต้นด้วย prefix + "/" เท่านั้น */
export const LOCAL_UI_REVIEW_PREFIXES = ["/admin/ui-gallery", "/business-workspace-template", "/workspace"] as const;

/** เดิม (2026-09-22) — คงไว้เพื่อความเข้ากันได้กับผู้เรียกที่มีอยู่จริง */
export const LOCAL_UI_REVIEW_PREFIX = LOCAL_UI_REVIEW_PREFIXES[0];

/** ชื่อ header ภายในที่ middleware ติดให้เฉพาะคำขอรีวิว (ถูก strip ทุกคำขออื่น) */
export const LOCAL_UI_REVIEW_HEADER = "x-dnaos-local-ui-review";

function isUnderPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function isLocalUiGalleryReviewPath(pathname: string): boolean {
  return isUnderPrefix(pathname, LOCAL_UI_REVIEW_PREFIX);
}

/** path ใด ๆ ที่อยู่ในรายการที่อนุญาตสำหรับ dev review */
export function isLocalReviewPath(pathname: string): boolean {
  return LOCAL_UI_REVIEW_PREFIXES.some((prefix) => isUnderPrefix(pathname, prefix));
}

export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0].toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/** คำขอรีวิวของ gallery โดยเฉพาะ (คงไว้เพื่อความเข้ากันได้กับผู้เรียกเดิม) */
export function isLocalUiGalleryReviewRequest(pathname: string, host: string | null | undefined): boolean {
  return isLocalReviewRequest(pathname, host) && isLocalUiGalleryReviewPath(pathname);
}

/** เงื่อนไขเดียวที่ทั้ง middleware และ layout ใช้ตัดสิน — ต้องจริงครบทั้ง 3 ข้อ */
export function isLocalReviewRequest(pathname: string, host: string | null | undefined): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    isLoopbackHost(host) &&
    isLocalReviewPath(pathname)
  );
}

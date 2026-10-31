import { redirect } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { needsWorkspaceUnlock, PIN_LENGTH } from "@/core/auth/screen-lock";
import { getWorkspaceScreenLock } from "@/gateway/auth";
import { isSafeInternalPath, resolveDestination } from "@/core/auth/resolveDestination";
import ScreenLockForm from "./ScreenLockForm";

// Deny STATE (not a UI style): when the server cannot read the lock state
// from the database, the workspace still cannot open. Fail-closed, per the
// owner directive — an unreadable gate must never read as "unlocked".
function ScreenLockUnreadableState() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-900 to-stone-700 flex items-center justify-center p-6">
      <div className="w-full max-w-xs text-center text-stone-100">
        <div className="text-[10px] font-bold tracking-[0.2em] text-stone-400 uppercase mb-2">DNA OS</div>
        <h1 className="text-xl font-bold">ยืนยันสถานะไม่สำเร็จ</h1>
        <p className="mt-3 text-xs text-stone-300 leading-relaxed">
          ระบบตรวจสถานะการล็อกจากฐานข้อมูลไม่ได้ในขณะนี้ —
          จึงยังไม่ปลดล็อกพื้นที่ทำงาน กรุณาลองใหม่ภายหลัง
        </p>
      </div>
    </div>
  );
}

// M031 — THE workspace screen lock. Shown when the user holds a valid
// Supabase Auth session but has not unlocked this browser session yet
// (requireAuthPage funnels everything here). Six digits, a numeric keypad
// and delete — NO email form and NO magic-link affordance here (directive 5);
// the single "จำ PIN ไม่ได้?" fallback returns to primary verification.
export default async function ScreenLockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const user = await getAuthedUser();
  if (!user) {
    redirect("/login");
  }

  const sp = await searchParams;
  const rawNext = typeof sp.next === "string" ? sp.next : null;
  const next =
    rawNext && isSafeInternalPath(rawNext) ? rawNext : resolveDestination(user.role);

  // M032 §05 fail-closed: the PIN existence read comes FIRST, and a failed
  // read renders the deny state — it never falls through to a workspace
  // bounce, and it never interprets a broken DB as "no PIN stored".
  // NOTE: redirect() THROWS in Next.js — redirects run OUTSIDE these
  // try/catches (a real browser run proved a swallowed NEXT_REDIRECT puts an
  // already-unlocked visitor onto the deny screen).
  let lock;
  let lockReadFailed = false;
  try {
    lock = await getWorkspaceScreenLock(user.id);
  } catch {
    lockReadFailed = true;
  }
  if (lockReadFailed) {
    return ScreenLockUnreadableState();
  }

  if (!lock) {
    // No PIN stored → nothing to lock with (pre-PIN accounts keep working).
    redirect(next);
  }

  let mustUnlock = false;
  let unlockedReadFailed = false;
  try {
    mustUnlock = await needsWorkspaceUnlock(user);
  } catch {
    unlockedReadFailed = true;
  }
  if (unlockedReadFailed) {
    return ScreenLockUnreadableState();
  }
  if (!mustUnlock) {
    // Direct visit while already unlocked → straight back to the workspace.
    redirect(next);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-900 to-stone-700 flex items-center justify-center p-6">
      <div className="w-full max-w-xs text-center text-stone-100">
        <div className="mb-6">
          <div className="text-[10px] font-bold tracking-[0.2em] text-stone-400 uppercase mb-2">
            DNA OS
          </div>
          <h1 className="text-xl font-bold">ปลดล็อกหน้าจอ</h1>
          <p className="mt-2 text-xs text-stone-400">
            กรอก PIN {PIN_LENGTH} หลักเพื่อกลับเข้าพื้นที่ทำงาน — session ของคุณยังใช้งานได้อยู่
          </p>
        </div>

        <ScreenLockForm next={next} />

        <p className="mt-10 text-[10px] text-stone-500 leading-relaxed">
          PIN เก็บเป็น hash ฝั่ง server เท่านั้น — ปลดล็อกได้เฉพาะเครื่อง/แท็บนี้
          ผู้อื่นหรือเครื่องอื่นแตะข้อมูลของคุณไม่ได้
        </p>
      </div>
    </div>
  );
}

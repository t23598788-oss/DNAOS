import { redirect } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { needsWorkspaceUnlock, PIN_LENGTH } from "@/core/auth/screen-lock";
import { getWorkspaceScreenLock } from "@/gateway/auth";
import { isSafeInternalPath, resolveDestination } from "@/core/auth/resolveDestination";
import ScreenLockForm from "./ScreenLockForm";

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

  const lock = await getWorkspaceScreenLock(user.id);
  if (!lock) {
    // No PIN stored → nothing to lock with (pre-PIN accounts keep working).
    redirect(next);
  }
  if (!(await needsWorkspaceUnlock(user))) {
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

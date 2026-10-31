import { redirect } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { hasWorkspacePin, hasFreshPrimaryVerification } from "@/core/auth/screen-lock";
import { isSafeInternalPath, resolveDestination } from "@/core/auth/resolveDestination";
import FirstPinForm from "./FirstPinForm";

// M031 — FIRST-TIME 6-digit PIN setup (directive 3). /auth/confirm lands
// here after the real Supabase Auth verification (magic link / OAuth) when
// the account has no PIN yet. M030's "must set password" step is GONE from
// the mandatory path (directive 9): this page only adds the PIN.
function verificationLabel(userId: string, providers: string[]): string {
  if (providers.some((p) => p !== "email" && p !== "magiclink")) return "OAuth";
  if (providers.includes("magiclink")) return "Magic Link";
  return "Supabase Auth";
}

export default async function FirstPinPage({
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

  // M032 §05 fail-closed: unreadable PIN state → deny, never assume "no PIN"
  // (that would let a locked workspace bounce through setup to escape the
  // lock while the server cannot verify anything). redirect() THROWS in
  // Next.js, so the redirects run OUTSIDE the try/catch guarding the DB read
  // (real browser evidence: a swallowed NEXT_REDIRECT denied a valid setup).
  let hasPin: boolean | null = null;
  try {
    hasPin = await hasWorkspacePin(user.id);
  } catch {
    hasPin = null; // unreadable state
  }
  if (hasPin === null) {
    redirect("/login?error=screen_lock_unavailable");
  }
  if (hasPin) {
    // Already set → there is nothing to set; go back to the intended target.
    redirect(next);
  }
  if (!(await hasFreshPrimaryVerification())) {
    // Only a JUST-verified session may create a PIN (directive 1 keeps
    // Supabase Auth as the sole identity verifier).
    redirect(next);
  }

  const providers = (user.identities ?? []).map((i) => i.provider);

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 to-stone-200 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl px-8 py-10">
          <div className="mb-6">
            <div className="text-[10px] font-bold tracking-[0.2em] text-stone-400 uppercase mb-3">
              DNA OS
            </div>
            <h1 className="text-2xl font-bold text-stone-900 leading-tight">
              ตั้ง PIN 6 หลัก
            </h1>
            <p className="mt-2 text-xs text-stone-400">
              ยืนยันตัวตนผ่าน {verificationLabel(user.id, providers)} สำเร็จ —
              ตั้ง PIN เพื่อปลดล็อกพื้นที่ทำงานครั้งถัดไป
            </p>
            <p className="mt-1 text-[10px] text-stone-500">{user.email}</p>
          </div>

          <FirstPinForm next={next} />
        </div>
      </div>
    </div>
  );
}

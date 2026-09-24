"use client";

import { useEffect, useState } from "react";

/**
 * PWA lifecycle (2026-09-24): registers public/sw.js and announces updates.
 *
 * - First visit: SW installs, caches only immutable static assets (see sw.js);
 *   no reload is triggered (a new controller must never interrupt typing).
 * - New version available: a small banner appears — "มีเวอร์ชันใหม่" — and the
 *   reload happens ONLY when the human presses รีเฟรช, so drafts/unsaved work
 *   survive. The banner states that honestly.
 * - The controllerchange→reload path fires only if a controller already
 *   existed at mount (never on first install).
 */
export default function PwaRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    const onControllerChange = () => {
      if (hadController) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        const announce = () => {
          if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        };
        announce();
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            if (sw.state === "installed") announce();
          });
        });
      })
      .catch(() => {
        /* ติดตั้ง SW ไม่ได้ → ใช้ผ่านเว็บตามปกติ (ไม่บังคับ) */
      });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting || dismissed) return null;

  return (
    <div className="fixed bottom-3 right-3 z-[90] max-w-xs rounded-xl border border-[#E9E1D6] bg-[#FDFBF8] p-3 shadow-lg">
      <p className="text-xs font-semibold text-stone-800">มีเวอร์ชันใหม่</p>
      <p className="mt-0.5 text-[11px] leading-snug text-stone-500">
        กดรีเฟรชเมื่อพร้อม — ถ้ามีข้อความ/ร่างที่ยังไม่ได้บันทึก ร่างนั้นจะหายเมื่อรีเฟรช
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => waiting.postMessage("SKIP_WAITING")}
          className="rounded-lg bg-stone-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-stone-800"
        >
          รีเฟรช
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg border border-stone-300 px-2.5 py-1 text-[11px] text-stone-600 hover:bg-stone-50"
        >
          ภายหลัง
        </button>
      </div>
    </div>
  );
}

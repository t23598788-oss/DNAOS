"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PinKeypad } from "@/components/auth/PinKeypad";

const PIN_LEN = 6;

// M031 — the ONE thing to do on the lock screen: 6 digits → unlock. No email
// field, no magic-link affordance (owner directive 5). "ลืม PIN?" goes back
// through PRIMARY verification (directive 7) — it never becomes a PIN reset
// form and never a second login method.
export default function ScreenLockForm({ next }: { next: string }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const submittingRef = useRef(false);
  submittingRef.current = submitting;

  // 6th digit → unlock attempt fires itself (Phone-lock behavior: no submit
  // button, the pad IS the button). submit() resets the state first, so a
  // retry never double-fires on the same value.
  useEffect(() => {
    if (pin.length === PIN_LEN && !submittingRef.current) {
      void submit(pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function submit(finalPin: string) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setAttemptsLeft(null);
    try {
      const res = await fetch("/api/auth/screen-lock/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ pin: finalPin }),
      });
      if (res.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        attemptsLeft?: number;
        retryAfterSeconds?: number;
      };
      if (res.status === 429) {
        setError(`พยายามผิดหลายครั้งเกินไป — ลองอีกครั้งหลัง ${body.retryAfterSeconds ?? 120} วินาที`);
        setAttemptsLeft(0);
      } else if (body.error === "invalid_pin") {
        setError("PIN ไม่ถูกต้อง ลองอีกครั้ง");
        setAttemptsLeft(body.attemptsLeft ?? null);
      } else if (body.error === "session_expired") {
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      } else {
        setError("เกิดข้อผิดพลาด — ลองอีกครั้ง");
      }
      setPin("");
    } catch {
      setError("เกิดข้อผิดพลาด — ลองอีกครั้ง");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PinKeypad
        value={pin}
        length={PIN_LEN}
        disabled={submitting}
        error={!!error}
        onDigit={(d: string) => setPin((p) => (p.length < PIN_LEN ? p + d : p))}
        onBackspace={() => setPin((p) => p.slice(0, -1))}
      />
      {error && (
        <p className="mt-3 text-xs text-red-300" data-test="lock-error" aria-live="polite">
          {error}
        </p>
      )}
      {attemptsLeft !== null && attemptsLeft > 0 && (
        <p className="mt-1 text-[10px] text-stone-400">
          พยายามคงเหลือ {attemptsLeft} ครั้ง
        </p>
      )}
      <button
        type="button"
        data-test="forgot-pin"
        onClick={() => router.push(`/login?next=${encodeURIComponent(next)}`)}
        className="mt-6 text-xs text-stone-300 underline underline-offset-2"
      >
        จำ PIN ไม่ได้? ใช้การยืนยันตัวตนหลัก
      </button>
    </div>
  );
}

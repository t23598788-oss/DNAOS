"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PinKeypad } from "@/components/auth/PinKeypad";

const PIN_LEN = 6;

type Stage = "create" | "confirm" | "done";

// M031, directive 3 — set the PIN twice: create (6 digits) → confirm
// (SAME 6 digits) → POST once. The server re-validates shape and hashes;
// plaintext lives only in this component's memory between the two rounds.
export default function FirstPinForm({ next }: { next: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("create");
  const [firstPin, setFirstPin] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(finalPin: string) {
    if (submitting || stage === "done") return;
    setError(null);

    if (stage === "create") {
      setFirstPin(finalPin);
      setStage("confirm");
      setPin("");
      return;
    }

    if (firstPin !== finalPin) {
      setError("PIN ทั้งสองรอบไม่ตรงกัน — ตั้งใหม่อีกครั้ง");
      setFirstPin(null);
      setStage("create");
      setPin("");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/screen-lock/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ pin: finalPin }),
      });
      if (res.ok) {
        setStage("done");
        // The setup route already issued the unlock cookie → straight into
        // the workspace the user was headed for (directive 4).
        router.replace(next);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(errorMessage(body.error));
      setFirstPin(null);
      setStage("create");
      setPin("");
    } catch {
      setError("เกิดข้อผิดพลาด — ลองอีกครั้ง");
      setFirstPin(null);
      setStage("create");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  function errorMessage(code?: string): string {
    switch (code) {
      case "pin_invalid":
        return "PIN ต้องเป็นตัวเลข 6 หลักเท่านั้น";
      case "pin_exists":
        return "คุณมี PIN อยู่แล้ว — กลับไปใช้หน้าปลดล็อกแทน";
      case "primary_verification_required":
        return "ต้องยืนยันตัวตนหลักก่อน — กลับไปยืนยันอีกครั้ง";
      default:
        return "เกิดข้อผิดพลาด — ลองอีกครั้ง";
    }
  }

  return (
    <div>
      <p className="text-xs text-stone-500 mb-3">
        {stage === "create"
          ? "กรอกตัวเลข 6 หลัก"
          : stage === "confirm"
            ? "ยืนยัน PIN อีกครั้ง"
            : "ตั้งเสร็จแล้ว — กำลังเข้าพื้นที่ทำงาน…"}
      </p>
      <PinKeypad
        value={pin}
        length={PIN_LEN}
        disabled={submitting}
        error={!!error}
        onDigit={(d: string) => setPin((p) => (p.length < PIN_LEN ? p + d : p))}
        onBackspace={() => setPin((p) => p.slice(0, -1))}
      />
      {error && (
        <p className="mt-3 text-xs text-red-500" data-test="first-pin-error" aria-live="polite">
          {error}
        </p>
      )}
      <p className="mt-6 text-[10px] text-stone-400 leading-relaxed">
        PIN ใช้เฉพาะปลดล็อกหน้าจอของคุณ ไม่ใช้แทนการเข้าสู่ระบบ
        เก็บในรูปแบบ hash — หากจำไม่ได้ ใช้การยืนยันตัวตนหลักกลับเข้ามาใหม่ได้เสมอ
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";

const tokenUrl = "/api/v1/sandbox/token";

export function SandboxTokenControls() {
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function createOrTest(action: "create" | "test") {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(tokenUrl, action === "create"
        ? { method: "POST" }
        : { headers: { "X-DNA-Token": token }, cache: "no-store" });
      if (response.status === 404) {
        setMessage("Sandbox ยังไม่ได้เปิดในเครื่องนี้");
        return;
      }
      if (!response.ok) {
        setMessage(action === "create" ? "สร้าง Sandbox Token ไม่สำเร็จ" : "Sandbox ไม่ยอมรับ Token นี้");
        return;
      }

      const result = await response.json() as { token?: string; environment?: string };
      if (result.token) {
        setToken(result.token);
        setMessage("สร้าง Sandbox Token แล้ว");
      } else if (result.environment === "sandbox") {
        setMessage("Sandbox ยืนยัน Token ผ่าน");
      }
    } catch {
      setMessage("ติดต่อ Sandbox ไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  return <div className="space-y-4">
    <button type="button" disabled={pending} className="rounded-md bg-sky-800 px-4 py-2 text-white disabled:opacity-60" onClick={() => void createOrTest("create")}>
      สร้าง Sandbox Token
    </button>
    {token && <div className="space-y-3">
      <label className="block text-sm font-semibold">
        Token ที่สร้าง
        <input readOnly value={token} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 font-mono" />
      </label>
      <button type="button" disabled={pending} className="rounded-md border border-stone-300 px-4 py-2 disabled:opacity-60" onClick={() => void createOrTest("test")}>
        ทดสอบ Token
      </button>
    </div>}
    <p role="status" className="text-sm">{message}</p>
  </div>;
}

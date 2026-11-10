'use client'

import { useRouter } from "next/navigation"

// ค่าเริ่มต้นคงเดิมทุกตัวอักษร (ผู้เรียกเดิมไม่ต้องแก้) — className เป็นทางออก
// ให้เมนู floating home button ใช้ logic เดียวกันแต่หน้าตาเป็นแถวเมนู
const DEFAULT_CLASS = "w-full text-left text-xs text-stone-400 hover:text-red-600 transition px-1 py-1"

export default function LogoutButton({ className = DEFAULT_CLASS }: { className?: string }) {
  const router = useRouter()

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className={className}
    >
      ออกจากระบบ
    </button>
  )
}

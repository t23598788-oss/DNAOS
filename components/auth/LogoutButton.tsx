'use client'

import { useRouter } from "next/navigation"

export default function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <button
      onClick={handleLogout}
      className="w-full text-left text-xs text-stone-400 hover:text-red-600 transition px-1 py-1"
    >
      ออกจากระบบ
    </button>
  )
}
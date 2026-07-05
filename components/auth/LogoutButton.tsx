'use client'

import { useRouter } from "next/navigation"
import { createClient } from "@supabase/supabase-js"

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export default function LogoutButton() {
  const router = useRouter()

  async function handleLogout() {
    await getSupabase().auth.signOut()
    document.cookie = "admin_session=; path=/; max-age=0"
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

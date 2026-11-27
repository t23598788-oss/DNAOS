"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyDocLinks({ destinations }: { destinations: Record<string, string> }) {
  const router = useRouter();
  useEffect(() => {
    function follow() {
      const anchor = window.location.hash.slice(1);
      if (Object.hasOwn(destinations, anchor)) router.replace(destinations[anchor]);
    }

    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [destinations, router]);
  return null;
}

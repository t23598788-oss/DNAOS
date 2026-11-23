import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "DNA OS — Connect business with clear rules",
  description: "Connect business, people, and services through clear ownership, permissions, and operating rules.",
}

export default function HomePage() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-[#050914]">
      <iframe
        src="/landing-preview/index.html"
        title="DNA OS business platform"
        className="h-full w-full border-0"
      />
    </main>
  )
}

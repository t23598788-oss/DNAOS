import type { Metadata } from "next";

// Server-only metadata for /login (the page itself is "use client" and cannot
// export metadata — this layout wraps it without touching the page).
export const metadata: Metadata = {
  title: "เข้าสู่ระบบ | DNA OS",
  description: "เข้าสู่ระบบ DNA OS — ระบบธุรกิจ เอกสาร บัญชี และงานขาย",
  alternates: { canonical: "/login" },
  openGraph: {
    title: "เข้าสู่ระบบ | DNA OS",
    description: "เข้าสู่ระบบ DNA OS",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "เข้าสู่ระบบ | DNA OS",
    description: "เข้าสู่ระบบ DNA OS",
    images: ["/opengraph-image"],
  },
  // Auth pages add no crawlable content of their own.
  robots: { index: false, follow: true },
};

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

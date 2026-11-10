import type { Metadata } from "next";

// Server-only metadata for /register (client page — see app/login/layout.tsx).
export const metadata: Metadata = {
  title: "สมัครใช้งาน | DNA OS",
  description: "สมัครใช้งาน DNA OS — ระบบธุรกิจ เอกสาร บัญชี และงานขาย",
  alternates: { canonical: "/register" },
  openGraph: {
    title: "สมัครใช้งาน | DNA OS",
    description: "สมัครใช้งาน DNA OS",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "สมัครใช้งาน | DNA OS",
    description: "สมัครใช้งาน DNA OS",
    images: ["/opengraph-image"],
  },
  robots: { index: false, follow: true },
};

export default function RegisterLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

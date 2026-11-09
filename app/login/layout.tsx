import type { Metadata } from "next";

// Server-only metadata for this segment: the page file is "use client" and
// cannot export metadata, so the layout carries it without touching the page.
export const metadata: Metadata = {
  title: "เข้าสู่ระบบ | DNA OS",
  description: "เข้าสู่ระบบ DNA OS — ระบบธุรกิจ เอกสาร บัญชี และงานขาย",
  alternates: { canonical: "/login" },
  openGraph: {
    title: "เข้าสู่ระบบ | DNA OS",
    description: "เข้าสู่ระบบ DNA OS — ระบบธุรกิจ เอกสาร บัญชี และงานขาย",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "เข้าสู่ระบบ | DNA OS",
    description: "เข้าสู่ระบบ DNA OS — ระบบธุรกิจ เอกสาร บัญชี และงานขาย",
    images: ["/opengraph-image"],
  },
  robots: { index: false, follow: true },
};

export default function SegmentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

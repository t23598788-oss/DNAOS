import type { Metadata } from "next";

// Server-only metadata for this segment: the page file is "use client" and
// cannot export metadata, so the layout carries it without touching the page.
export const metadata: Metadata = {
  title: "Playground | DNA OS",
  description: "ทดลองสั่งงาน DNA OS ด้วยภาษาธรรมชาติ และดูผลลัพธ์จากระบบจริง",
  alternates: { canonical: "/playground" },
  openGraph: {
    title: "Playground | DNA OS",
    description: "ทดลองสั่งงาน DNA OS ด้วยภาษาธรรมชาติ และดูผลลัพธ์จากระบบจริง",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Playground | DNA OS",
    description: "ทดลองสั่งงาน DNA OS ด้วยภาษาธรรมชาติ และดูผลลัพธ์จากระบบจริง",
    images: ["/opengraph-image"],
  },
};

export default function SegmentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

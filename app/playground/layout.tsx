import type { Metadata } from "next";

// Server-only metadata for /playground (client page — see app/login/layout.tsx).
export const metadata: Metadata = {
  title: "Playground | DNA OS",
  description: "ทดลองสั่งงาน DNA OS ด้วยภาษาธรรมชาติ และดูผลลัพธ์จากระบบจริง",
  alternates: { canonical: "/playground" },
  openGraph: {
    title: "Playground | DNA OS",
    description: "ทดลองสั่งงาน DNA OS ด้วยภาษาธรรมชาติ",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Playground | DNA OS",
    description: "ทดลองสั่งงาน DNA OS ด้วยภาษาธรรมชาติ",
    images: ["/opengraph-image"],
  },
};

export default function PlaygroundLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}

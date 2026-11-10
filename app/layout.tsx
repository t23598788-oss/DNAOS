import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PwaRegistration from "@/components/pwa/PwaRegistration";
import FloatingHomeButton from "@/presentation/ui/FloatingHomeButton";
import { appBaseUrl } from "@/config/system-links";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Absolute origin for metadata/structured data (2026-10-24). Env-sourced via
// config/system-links.ts so no domain literal is ever written in app code
// (registry/hardcode-governance/service-endpoint-registry.json). null in local
// dev without the var → metadataBase/url are simply omitted, nothing invented.
const siteBase = appBaseUrl();

const SITE_DESCRIPTION = "Command-driven liquidity & logistics OS";

const DEFAULT_OG = {
  title: "DNA OS",
  description: SITE_DESCRIPTION,
  // File-based convention: app/opengraph-image.tsx (1200x630). Relative on
  // purpose — metadataBase above makes it absolute on the serving origin.
  images: ["/opengraph-image"],
};

export const metadata: Metadata = {
  metadataBase: siteBase ? new URL(siteBase) : undefined,
  title: "DNA OS",
  description: SITE_DESCRIPTION,
  manifest: "/manifest.json",
  openGraph: { type: "website", ...DEFAULT_OG },
  twitter: { card: "summary_large_image", ...DEFAULT_OG },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DNA OS",
  },
};

// Structured data — Organization + WebSite ONLY, and ONLY the facts this
// system can verify about ITSELF (brand name it already renders, origin it
// actually serves from). No Product/Offer/Service/LocalBusiness is emitted:
// there is no published-listing record anywhere in the schema yet (see
// supabase/migrations/20260710000008_restore_pit_pricing_tables.sql —
// pit_materials/pit_profiles are service_role_only and carry no publication
// permission), and no review, rating, telephone, geo coordinates, price or
// availability is ever synthesized here.
function organizationJsonLd(): string | null {
  if (!siteBase) return null;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${siteBase}/#organization`, name: "DNA OS", url: siteBase },
      { "@type": "WebSite", "@id": `${siteBase}/#website`, name: "DNA OS", url: siteBase, publisher: { "@id": `${siteBase}/#organization` } },
    ],
  });
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jsonLd = organizationJsonLd();
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content="#0b0f1a" />
        {jsonLd && (
          <script
            type="application/ld+json"
            // Static, JSON.stringify'd, no user input — no injection surface.
            dangerouslySetInnerHTML={{ __html: jsonLd }}
          />
        )}
      </head>
      <body className="min-h-full flex flex-col bg-white">
        <PwaRegistration />
        {/* ONE NAVIGATION — ปุ่มลอยปุ่มเดียวของทั้งระบบ (ไม่มี sidebar/topbar แล้ว)
            อยู่ที่ root ⇒ ทุก route ได้ปุ่มเดียวกัน ไม่ต้อง mount ซ้ำรายหน้า */}
        <FloatingHomeButton />
        {children}
      </body>
    </html>
  );
}

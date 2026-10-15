import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PwaRegistration from "@/components/pwa/PwaRegistration";
import { APP_SCOPE_HEADER } from "@/core/auth/surfacePolicy";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * SEPARATE INSTALL EXPERIENCE (owner directive 2026-10-15 continuation) —
 * Business App และ Developer App มีจุดติดตั้ง/ขอบเขตแอปแยกกัน:
 *  - Business surface (default, และหน้า login/install ที่ middleware ไม่ได้ stamp
 *    header) → manifest.json (start_url = /workspace) — เปิด Business Workspace
 *  - Developer surface (/developer, /admin/ide, dev-loop, deploy, ui-gallery,
 *    infrastructure, …) → manifest-developer.json (start_url = /developer)
 * middleware.ts stamps APP_SCOPE_HEADER (x-dnaos-app) จาก registry เดียวกับ
 * surfacePolicy — ไม่มี role ใหม่ ไม่มี auth ใหม่ · ใช้ Supabase Auth + Session เดิม
 */
export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const appScope = requestHeaders.get(APP_SCOPE_HEADER);
  const manifest = appScope === "developer" ? "/manifest-developer.json" : "/manifest.json";
  return {
    title: "DNA OS — Dead Board",
    description: "Command-driven liquidity & logistics OS",
    manifest,
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "DNA OS",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content="#0b0f1a" />
      </head>
      <body className="min-h-full flex flex-col">
        <PwaRegistration />
        {children}
      </body>
    </html>
  );
}

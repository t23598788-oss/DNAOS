import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PwaRegistration from "@/components/pwa/PwaRegistration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// WORKSPACE VIEWPORT LOCK (owner 2026-10-19, ข้อ 2–3): 100dvh ทั้งแอป · viewport-fit=cover
// เพื่อให้ env(safe-area-inset-*) มีค่าจริงบนอุปกรณ์ที่มี notch · ไม่มี CSS ซ่อนแถบ
// แท็บเบราว์เซอร์ — เปิดเป็นแอปเดียวก็ใช้ standalone จาก manifest.json เดิม
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "DNA OS — Dead Board",
  description: "Command-driven liquidity & logistics OS",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "DNA OS",
  },
};

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

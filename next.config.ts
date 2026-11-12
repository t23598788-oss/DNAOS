import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdfkit (แล้ว sharp) ต้อง resolve path ไฟล์ data ของตัวเองจาก node_modules
  // จริง — ถ้าถูก bundle เข้า server chunk, __dirname กลายเป็น /ROOT (turbopack
  // virtual root) แล้ว createPdf ตายด้วย ENOENT Helvetica.afm (พบจริงตอนเปิด
  // document-preview route บน dev) — external ไว้ = เส้นทางที่ renderer เดิมใช้
  // ได้ทั้ง dev และ production build · @fontsource/noto-sans-thai ถูก external
  // ด้วยเหตุผลเดียวกัน: artifact.ts ใช้ require.resolve(subpath) เพื่อป้อน
  // ไฟล์ .woff เข้า pdfkit — ถ้าโดน bundle จะได้ path เสมือน [project]/... ที่
  // เปิดไฟล์จริงไม่ได้ (ENOENT ที่พบจริงตอน dev)
  serverExternalPackages: ["pdfkit", "sharp", "@fontsource/noto-sans-thai"],
  turbopack: {
    root: __dirname,
  },
  // Found live 2026-07-31: Vercel rejected api/admin/runtime/document-engine
  // at 3.7GB uncompressed (limit 250MB). Root cause: engines/documents/
  // selfDescription.ts reads registry/*.json via a dynamically-constructed
  // path (join(__dirname, "../.."), then join(ROOT, relPath)) — Next's
  // output file tracer can't statically resolve that, so it fell back to
  // including the whole project root, sweeping in src-tauri/target's 3.1GB
  // of Rust build artifacts (created by `tauri build` the same day) plus
  // node_modules cruft. Excluding the directories no server route ever
  // needs at runtime is the standard fix for this tracer fallback, not a
  // guess — verified these are genuinely unused by any API route.
  outputFileTracingExcludes: {
    "*": [
      "src-tauri/**",
      "backups/**",
      "node_modules/.cache/**",
      "supabase/local-migration/**",
      ".next-tauri-placeholder/**",
    ],
  },
};

export default nextConfig;

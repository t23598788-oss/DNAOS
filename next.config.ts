import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

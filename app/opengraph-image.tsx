/**
 * /opengraph-image — default social preview for every route that does not
 * define its own (Next file convention: sets og:image + its dimensions).
 *
 * Colours are NOT invented here:
 *   background "#0b0f1a" = the theme-color this app already declares in
 *                          app/layout.tsx (<meta name="theme-color">)
 *   text      "#ededed" = --foreground from app/globals.css (dark block)
 * The mark is the existing public/brand/dna-os-mark-d.png, inlined so the
 * route needs no network fetch at render time.
 */
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "DNA OS";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const mark = await readFile(join(process.cwd(), "public", "brand", "dna-os-mark-d.png"));
  const markSrc = `data:image/png;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 56,
          padding: "0 96px",
          background: "#0b0f1a",
          color: "#ededed",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markSrc} alt="" width={240} height={240} style={{ borderRadius: 24 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 108, fontWeight: 700, letterSpacing: -2, lineHeight: 1 }}>DNA OS</div>
          <div style={{ fontSize: 34, color: "#ededed", opacity: 0.72, lineHeight: 1.35 }}>
            Command-driven liquidity &amp; logistics OS
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

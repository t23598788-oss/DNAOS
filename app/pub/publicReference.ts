/**
 * PUBLIC REFERENCE (owner 2026-10-20) — single source for DNA OS public identity.
 *
 * Every field here must be verifiable from the codebase or the live site.
 * Do NOT add company details, prices, stock, or capabilities without evidence.
 */
export const PUBLIC_REFERENCE = {
  name: "DNA OS",
  url: "https://dnaos.dev",
  description: "Command-driven liquidity & logistics OS",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  // Capabilities that exist in code today (resource self-service in /api/public/resources).
  featureList: [
    "ลงทะเบียนแหล่งทรัพยากรและวัสดุของตนเอง (create_my_site / add_material)",
    "แก้ไขราคาวัสดุของตนเองโดยผู้ลงทะเบียนเท่านั้น (update_price)",
    "ค้นหาทะเบียนทรัพยากรสาธารณะ (เฉพาะรายการที่มีหลักฐานเจ้าของ)",
  ],
  // Entry points that exist as pages today.
  signupUrl: "https://dnaos.dev/pub/register",
  loginUrl: "https://dnaos.dev/login",
} as const;

/** Schema.org SoftwareApplication JSON-LD built only from PUBLIC_REFERENCE. */
export function publicJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PUBLIC_REFERENCE.name,
    url: PUBLIC_REFERENCE.url,
    description: PUBLIC_REFERENCE.description,
    applicationCategory: PUBLIC_REFERENCE.applicationCategory,
    operatingSystem: PUBLIC_REFERENCE.operatingSystem,
    featureList: [...PUBLIC_REFERENCE.featureList],
    potentialAction: {
      "@type": "RegisterAction",
      target: PUBLIC_REFERENCE.signupUrl,
    },
  };
}

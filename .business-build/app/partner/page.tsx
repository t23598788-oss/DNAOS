import { PartnerPortal } from "./_lib/PartnerPortal";

/**
 * PARTNER (seller / resource owner) — the real screen for the capabilities the
 * `partner` role already has: own resource sites, materials and prices through
 * /api/public/resources. Auth and shell stay in layout.tsx (requireAuthPage).
 */
export default function PartnerPortalPage() {
  return (
    <div className="p-6">
      <PartnerPortal />
    </div>
  );
}

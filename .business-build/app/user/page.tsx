import { BuyerPortal } from "./_lib/BuyerPortal";

/**
 * USER (buyer / customer) — the real screen for the capabilities the
 * `customer` role already has: published registry search + quote request
 * through /api/public/resources. Auth and shell stay in layout.tsx.
 */
export default function UserPortalPage() {
  return (
    <div className="p-6">
      <BuyerPortal />
    </div>
  );
}

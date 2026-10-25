import { TransporterPortal } from "./_lib/TransporterPortal";

/**
 * TRANSPORTER — reads only the signed-in driver's assigned jobs from the
 * existing jobs table. Auth and shell stay in layout.tsx.
 */
export default function TransporterPage() {
  return (
    <div className="p-6">
      <TransporterPortal />
    </div>
  );
}

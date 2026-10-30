import DebtTrackingManager from "@/components/documents/DebtTrackingManager"

// The original debt-tracking screen. M026's reminder workbench is rendered
// INSIDE DebtTrackingManager (one route, one screen) rather than behind a
// separate tab shell — M029 restored the original surface and removed the
// extra navigation layer.
export default function DebtTrackingPage() {
  return <DebtTrackingManager />
}

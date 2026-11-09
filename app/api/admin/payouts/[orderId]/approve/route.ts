import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { executeApprovedPayout } from "@/engines/integration-gateway/workers/payout-worker";

// Local/admin-only approval gate. Money moves only when this route is called
// with the internal secret, and only for an order already in
// PAYOUT_PENDING_APPROVAL (the worker itself enforces PAYOUT_APPROVED).

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const expectedSecret = process.env.PAYOUT_APPROVAL_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "payout approval not configured" },
      { status: 503 },
    );
  }

  const providedSecret = req.headers.get("x-admin-secret");
  if (!providedSecret || !secretMatches(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const rawActorId =
    body && typeof body === "object"
      ? (body as { actorId?: unknown }).actorId
      : undefined;
  const actorId = typeof rawActorId === "string" ? rawActorId.trim() : "";

  if (!actorId) {
    return NextResponse.json({ error: "actorId is required" }, { status: 400 });
  }

  const { orderId } = await params;

  try {
    const result = await executeApprovedPayout(orderId, actorId);

    // The worker reports { success, failed } rather than { ok }: success>0
    // means the payout API accepted it and the order is SETTLED.
    if (result.success > 0) {
      return NextResponse.json({ ok: true, orderId, status: "approved" });
    }

    return NextResponse.json(
      {
        ok: false,
        orderId,
        reason:
          result.failed > 0
            ? "payout API rejected the payout (order marked PAYOUT_FAILED)"
            : "order is not in PAYOUT_APPROVED state (not pending approval, already approved, or already settled)",
      },
      { status: 409 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    );
  }
}

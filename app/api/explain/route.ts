import { NextRequest, NextResponse } from "next/server";
import { explainQuote } from "@/lib/v5-presenter/explainer";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.pit_id) {
      return NextResponse.json({ ok: false, error: "ต้องระบุ pit_id" }, { status: 400 });
    }

    const result = await explainQuote({
      pit_id: body.pit_id,
      site_lat: body.site_lat ?? 16.4314,
      site_lng: body.site_lng ?? 102.835,
      quantity: body.quantity ?? 100,
      material_type_id: body.material_type_id,
      vehicle_type_id: body.vehicle_type_id,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "internal error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { dispatchAction } from "@/lib/actions/dna-actions";
import { dispatchFind } from "@/lib/actions/find-resolver";
import { enrichPitResults, enrichPartnerResults } from "@/lib/presenter/enricher";
import { formatPitResults, formatPartnerResults } from "@/lib/presenter/formatter";
import { detectRankContext, rankResults } from "@/lib/presenter/ranker";
import type { ActionRequest } from "@/lib/actions/dna-actions";

// DNA OS HQ — ขอนแก่น
const HQ_LAT = 16.4714;
const HQ_LNG = 102.9738;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ---- FIND endpoint + V5 Presenter ----
    if (body.type === "find") {
      if (!body.domain || !body.keyword) {
        return NextResponse.json(
          { ok: false, error: "ต้องระบุ domain และ keyword" },
          { status: 400 }
        );
      }

      const result = await dispatchFind(body.domain, body.keyword);

      // V5: Enrich + Format ถ้าเจอข้อมูล
      if (result.ok && result.record) {
        const rawData = result.record.results as Record<string, unknown>[] | undefined;

        if (rawData && Array.isArray(rawData)) {
          if (body.domain === "pit" || body.domain === "partner") {
            // ตรวจว่าเป็น pit data หรือ partner data
            const isPit = rawData[0] && ("pit_name" in rawData[0] || "latitude" in rawData[0]);

            const question = body.question ?? body.keyword;
            const rankCtx = detectRankContext(question);

            if (isPit) {
              const enriched = await enrichPitResults(rawData, HQ_LAT, HQ_LNG);
              const ranked = rankResults(enriched, rankCtx);
              const formatted = formatPitResults(ranked, body.keyword);
              return NextResponse.json({ ...result, record: { ...result.record, enriched: ranked, formatted, rank: rankCtx } });
            } else {
              const enriched = await enrichPartnerResults(rawData);
              const formatted = formatPartnerResults(enriched, body.keyword);
              return NextResponse.json({ ...result, record: { ...result.record, enriched, formatted, rank: rankCtx } });
            }
          }
        }
      }

      return NextResponse.json(result);
    }

    // ---- ACTION endpoint (preview / execute) ----
    const actionReq: ActionRequest = body;

    if (!actionReq.action || !actionReq.mode) {
      return NextResponse.json(
        { ok: false, error: "ต้องระบุ action และ mode (preview|execute)" },
        { status: 400 }
      );
    }

    if (actionReq.mode !== "preview" && actionReq.mode !== "execute") {
      return NextResponse.json(
        { ok: false, error: "mode ต้องเป็น preview หรือ execute" },
        { status: 400 }
      );
    }

    const result = await dispatchAction(actionReq);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "internal error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

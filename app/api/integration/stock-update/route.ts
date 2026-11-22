import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  ingestParsedStockUpdate,
  parseStockUpdate,
  StockUpdateInputError,
  type StockUpdateInput,
  type StockUpdateResult,
} from "@/engines/integration-gateway/stockIngestion";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

async function secretMatches(supplied: string | null, expected: string): Promise<boolean> {
  if (!supplied) return false;
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actualHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let mismatch = actualBytes.length ^ expectedBytes.length;
  for (let i = 0; i < actualBytes.length; i += 1) mismatch |= actualBytes[i] ^ expectedBytes[i];
  return mismatch === 0;
}

function statusForRpcError(code: string | undefined): number {
  switch (code) {
    case "42501": return 403;
    case "P0002": return 409;
    case "23505": return 409;
    case "22023": return 400;
    default: return 500;
  }
}

export async function POST(request: Request) {
  const ingestSecret = process.env.STOCK_INGEST_SECRET;
  if (!ingestSecret) {
    return NextResponse.json({ ok: false, error: "stock ingestion is not configured" }, { status: 503 });
  }
  if (!(await secretMatches(request.headers.get("x-stock-ingest-secret"), ingestSecret))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "request body too large" }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: "could not read request body" }, { status: 400 });
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "request body too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: "stock ingestion database is not configured" }, { status: 503 });
  }

  let input: StockUpdateInput;
  try {
    // Validation happens before opening a privileged database client.
    input = parseStockUpdate(body);
  } catch (error) {
    if (error instanceof StockUpdateInputError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const result = await ingestParsedStockUpdate(input, {
      async applyMovement(command): Promise<StockUpdateResult> {
        const { data, error } = await db.rpc("apply_stock_shadow_movement", {
          p_adapter_id: command.adapterId,
          p_idempotency_key: command.idempotencyKey,
          p_external_entry_key: command.externalEntryKey,
          p_external_item_code: command.externalItemCode,
          p_external_warehouse_key: command.externalWarehouseKey,
          p_quantity_delta: command.quantityDelta,
          p_stock_uom: command.stockUom,
          p_occurred_at: command.occurredAt,
          p_source_document_key: command.sourceDocumentKey,
        });
        if (error) {
          const status = statusForRpcError(error.code);
          const message = status === 403
            ? "adapter is not authorized for stock ingestion"
            : status === 409
              ? "stock reference, starting balance, or idempotency conflict"
              : status === 400
                ? "stock movement was rejected"
                : "stock ingestion failed";
          throw Object.assign(new Error(message), { status });
        }
        return data as StockUpdateResult;
      },
    });
    return NextResponse.json({ ok: true, data: result }, { status: 200 });
  } catch (error) {
    const status = error instanceof Error && "status" in error
      ? Number((error as Error & { status?: number }).status)
      : 500;
    const message = error instanceof Error && "status" in error
      ? error.message
      : "stock ingestion failed";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

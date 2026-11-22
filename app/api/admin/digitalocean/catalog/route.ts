import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";
import { createMeteredDigitalOceanClient, DigitalOceanRateLimitError, fetchAllPages, resourceKey } from "../_lib/meteredClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const db = supabaseAdmin();
  const { data: latest, error: latestError } = await db.from("do_catalog").select("fetched_at")
    .order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  if (latestError) return NextResponse.json({ ok: false, code: "DO_CATALOG_NOT_READY" }, { status: 503 });
  if (!latest) return NextResponse.json({ ok: true, fetched_at: null, items: [] }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  const { data, error } = await db.from("do_catalog").select("resource_type,resource_key,payload,fetched_at")
    .eq("fetched_at", latest.fetched_at).order("resource_type").order("resource_key");
  if (error) return NextResponse.json({ ok: false, code: "DO_CATALOG_NOT_READY" }, { status: 503 });
  return NextResponse.json({ ok: true, fetched_at: latest.fetched_at, items: data ?? [] }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: Request) {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  try {
    const client = await createMeteredDigitalOceanClient();
    const requestedKey = request.headers.get("idempotency-key")?.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 160) || `catalog-${randomUUID()}`;
    const [sizes, oneClicksResponse, regions, optionsResponse] = await Promise.all([
      fetchAllPages<unknown>(client, "catalog.sizes", "/v2/sizes", "sizes", `${requestedKey}:sizes`),
      client.request<Record<string, unknown>>("catalog.one_clicks", "/v2/1-clicks", `${requestedKey}:one-clicks`),
      fetchAllPages<unknown>(client, "catalog.regions", "/v2/regions", "regions", `${requestedKey}:regions`),
      client.request<Record<string, unknown>>("catalog.database_options", "/v2/databases/options", `${requestedKey}:database-options`),
    ]);
    const apps = oneClicksResponse["1_clicks"];
    if (!Array.isArray(apps)) throw new Error("DIGITALOCEAN_ONE_CLICKS_MISSING");
    const options = optionsResponse.options;
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("DIGITALOCEAN_DATABASE_OPTIONS_MISSING");
    const databaseOptions = Object.entries(options as Record<string, unknown>);
    const fetchedAt = new Date().toISOString();
    const rows = [
      ...sizes.map((payload, index) => ({ resource_type: "droplet_size", resource_key: resourceKey(payload, index), payload, fetched_at: fetchedAt })),
      ...(apps as unknown[]).map((payload, index) => ({ resource_type: "one_click_app", resource_key: resourceKey(payload, index), payload, fetched_at: fetchedAt })),
      ...regions.map((payload, index) => ({ resource_type: "region", resource_key: resourceKey(payload, index), payload, fetched_at: fetchedAt })),
      ...databaseOptions.map(([engine, payload]) => ({ resource_type: "database_option", resource_key: engine, payload, fetched_at: fetchedAt })),
    ];
    const { error } = await supabaseAdmin().from("do_catalog").upsert(rows, { onConflict: "resource_type,resource_key" });
    if (error) return NextResponse.json({ ok: false, code: "DO_CATALOG_WRITE_FAILED" }, { status: 503 });
    return NextResponse.json({ ok: true, fetched_at: fetchedAt, counts: { droplet_sizes: sizes.length, one_click_apps: apps.length, regions: regions.length, database_options: databaseOptions.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DIGITALOCEAN_CATALOG_REFRESH_FAILED";
    const status = message === "DIGITALOCEAN_BALANCE_GATE_BLOCKED" ? 402 : error instanceof DigitalOceanRateLimitError ? 429 : message === "DIGITALOCEAN_CREDENTIAL_MISSING" || message === "DIGITALOCEAN_BALANCE_GATE_UNAVAILABLE" || message === "DIGITALOCEAN_RATE_LIMITER_UNAVAILABLE" ? 503 : 502;
    const headers = error instanceof DigitalOceanRateLimitError ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
    return NextResponse.json({ ok: false, code: message }, { status, headers });
  }
}

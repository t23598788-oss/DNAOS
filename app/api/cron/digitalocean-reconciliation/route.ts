import { NextResponse } from "next/server";
import { createMeteredDigitalOceanClient, DigitalOceanRateLimitError, digitalOceanAccountUrn, fetchAllPages, finiteMoney } from "@/app/api/admin/digitalocean/_lib/meteredClient";
import { supabaseAdmin } from "@/services/supabase/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function utcDate(date: Date): string { return date.toISOString().slice(0, 10); }
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function invoiceSummary(invoice: Record<string, unknown>): Record<string, unknown> {
  const safe = (value: unknown) => {
    const source = object(value);
    return source ? { name: source.name ?? null, amount: source.amount ?? null } : null;
  };
  const productCharges = object(invoice.product_charges);
  return {
    amount: invoice.amount ?? null,
    invoice_id: invoice.invoice_id ?? null,
    invoice_uuid: invoice.invoice_uuid ?? null,
    invoice_period: invoice.invoice_period ?? invoice.billing_period ?? null,
    updated_at: invoice.updated_at ?? null,
    credits_and_adjustments: safe(invoice.credits_and_adjustments),
    overages: safe(invoice.overages),
    taxes: safe(invoice.taxes),
    product_charges: productCharges ? {
      name: productCharges.name ?? null,
      amount: productCharges.amount ?? null,
      items: Array.isArray(productCharges.items) ? productCharges.items.map((item) => {
        const row = object(item);
        return row ? { name: row.name ?? null, amount: row.amount ?? null, count: row.count ?? null } : null;
      }).filter(Boolean) : [],
    } : null,
  };
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  const runKey = `digitalocean-daily:${utcDate(new Date())}`;
  try {
    const client = await createMeteredDigitalOceanClient();
    const accountUrn = digitalOceanAccountUrn();
    if (!accountUrn) {
      return NextResponse.json({ ok: false, code: "DIGITALOCEAN_ACCOUNT_URN_MISSING" }, { status: 503 });
    }

    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const startDate = utcDate(start);
    const endDate = startDate;
    const baseKey = runKey.replace(/[^a-zA-Z0-9:_-]/g, "");
    const invoicePreviewHolder: { value: Record<string, unknown> | null } = { value: null };
    const [balanceResult, prepaymentResult, history, invoices, insights] = await Promise.all([
      client.request("billing.balance", "/v2/customers/my/balance", `${baseKey}:balance`),
      client.request("billing.prepayment_status", "/v2/customers/my/prepayment_status", `${baseKey}:prepayment-status`),
      fetchAllPages<unknown>(client, "billing.history", "/v2/customers/my/billing_history", "billing_history", `${baseKey}:history`),
      fetchAllPages<unknown>(client, "billing.invoices", "/v2/customers/my/invoices", "invoices", `${baseKey}:invoices`, (page) => { invoicePreviewHolder.value = object(page.invoice_preview); }),
      fetchAllPages<unknown>(client, "billing.insights", `/v2/billing/${encodeURIComponent(accountUrn)}/insights/${startDate}/${endDate}`, "data_points", `${baseKey}:insights`),
    ]);

    const since = `${startDate}T00:00:00.000Z`;
    const until = `${utcDate(now)}T00:00:00.000Z`;
    const db = supabaseAdmin();
    const [usageResult, callsResult] = await Promise.all([
      db.from("do_usage_events").select("estimated_resource_cost_usd")
        .gte("created_at", since).lt("created_at", until).eq("outcome", "succeeded"),
      db.from("do_usage_events").select("id", { count: "exact", head: true })
        .gte("created_at", since).lt("created_at", until),
    ]);
    if (usageResult.error || callsResult.error) throw new Error("DIGITALOCEAN_USAGE_LEDGER_UNAVAILABLE");

    const gatewayEstimate = (usageResult.data ?? []).reduce<number>((sum, row) => sum + (finiteMoney(row.estimated_resource_cost_usd) ?? 0), 0);
    const providerTotal = insights.reduce<number>((sum, item) => sum + (finiteMoney(object(item)?.total_amount) ?? 0), 0);
    const invoicePreview = invoicePreviewHolder.value;
    const variance = providerTotal - gatewayEstimate;
    const hasComparableUsage = (callsResult.count ?? 0) > 0;
    const status = !insights.length || !hasComparableUsage
      ? "incomplete"
      : Math.abs(variance) > 0.01 ? "discrepancy" : "matched";
    const balance = object(balanceResult);
    const prepayment = object(object(prepaymentResult)?.status);
    const invoiceRows = [...invoices.map((item) => ({ invoice: object(item), isPreview: false })), ...(invoicePreview ? [{ invoice: invoicePreview, isPreview: true }] : [])]
      .flatMap(({ invoice, isPreview }) => {
        if (!invoice) return [];
        const summary = invoiceSummary(invoice);
        const period = typeof summary.invoice_period === "string" ? summary.invoice_period : null;
        const uuid = typeof summary.invoice_uuid === "string" ? summary.invoice_uuid : null;
        return [{
          invoice_uuid: uuid ?? `preview:${period ?? utcDate(now)}`,
          invoice_id: typeof summary.invoice_id === "string" ? summary.invoice_id : null,
          invoice_period: period,
          amount_usd: finiteMoney(summary.amount),
          updated_at: typeof summary.updated_at === "string" ? summary.updated_at : null,
          is_preview: isPreview,
          safe_summary: summary,
          fetched_at: now.toISOString(),
        }];
      });
    if (invoiceRows.length) {
      const { error: invoiceError } = await db.from("do_billing_invoices").upsert(invoiceRows, { onConflict: "invoice_uuid" });
      if (invoiceError) throw new Error("DIGITALOCEAN_INVOICE_WRITE_FAILED");
    }

    // Mirror actual, non-preview DO invoices into the system cost registry.
    // Gateway per-request estimates remain a separate meter and are never
    // added to an account-level invoice. If the registry migration is not yet
    // installed, preserve the existing reconciliation and report that gap.
    const responsibilityWarnings: string[] = [];
    if (invoiceRows.some((row) => !row.is_preview && row.amount_usd !== null && row.invoice_uuid)) {
      const systemDb = db.schema("system");
      const { data: existingAccount, error: accountReadError } = await systemDb
        .from("responsibility_accounts")
        .select("id")
        .eq("provider_code", "digitalocean")
        .eq("account_kind", "provider_account")
        .eq("provider_account_ref", accountUrn)
        .maybeSingle();

      let billingAccountId: string | null = null;
      if (accountReadError) {
        responsibilityWarnings.push("system responsibility registry unavailable; invoice ownership not mirrored");
      } else if (existingAccount) {
        billingAccountId = existingAccount.id;
      } else {
        const { data: insertedAccount, error: accountInsertError } = await systemDb
          .from("responsibility_accounts")
          .insert({
            provider_code: "digitalocean",
            account_kind: "provider_account",
            provider_account_ref: accountUrn,
            display_name: "DigitalOcean billing account",
            owner_kind: "unassigned",
            attribution_status: "unverified",
          })
          .select("id")
          .single();
        if (accountInsertError) {
          responsibilityWarnings.push("DigitalOcean billing account could not be registered for owner attribution");
        } else {
          billingAccountId = insertedAccount.id;
        }
      }

      if (billingAccountId) {
        for (const row of invoiceRows) {
          if (row.is_preview || row.amount_usd === null || !row.invoice_uuid) continue;
          const period = row.invoice_period ?? "unknown period";
          const sourceRevision = row.updated_at ? `:${row.updated_at}` : "";
          const sourceReference = `digitalocean:invoice:${row.invoice_uuid}${sourceRevision}`;
          const { error: registryError } = await systemDb.rpc("upsert_provider_invoice_cost", {
            p_provider_invoice_key: `digitalocean:${row.invoice_uuid}`,
            p_service_name: `DigitalOcean account invoice ${period}`,
            p_amount: row.amount_usd,
            p_currency: "USD",
            p_billing_cycle: row.invoice_period ? "monthly" : null,
            p_payer_account_id: billingAccountId,
            p_source_reference: sourceReference,
            p_observed_at: row.fetched_at,
            p_sanitized_attributes: row.safe_summary,
          });
          if (registryError) responsibilityWarnings.push(`invoice ${row.invoice_uuid} not mirrored to system registry`);
        }
      }
    }
    const recon = {
      run_key: runKey,
      account_urn: accountUrn,
      period_start: startDate,
      period_end: endDate,
      account_balance_usd: finiteMoney(balance?.account_balance),
      prepayment_balance_usd: finiteMoney(prepayment?.balance),
      prepayment_blocked: typeof prepayment?.blocked === "boolean" ? prepayment.blocked : null,
      month_to_date_balance_usd: finiteMoney(balance?.month_to_date_balance),
      month_to_date_usage_usd: finiteMoney(balance?.month_to_date_usage),
      provider_insights_total_usd: insights.length ? providerTotal : null,
      gateway_estimated_cost_usd: gatewayEstimate,
      variance_usd: hasComparableUsage && insights.length ? variance : null,
      variance_basis: "aggregate_only_not_per_request_attribution",
      billing_history: history,
      sku_insights: insights,
      status,
      detail: status === "incomplete"
        ? "ข้อมูลรายวันยังไม่ครบ หรือไม่มี Usage Meter ที่เทียบได้; billing history ใช้ประกอบเหตุการณ์บัญชี ไม่ใช่ยอด SKU รายการเดียวกัน"
        : status === "discrepancy"
          ? "ยอด SKU รายวันของ DigitalOcean ต่างจากยอดต้นทุนทรัพยากรที่ Gateway ประเมิน; ตรวจ SKU/ทรัพยากรที่ยังไม่ผูกกับคำสั่ง"
          : "ยอดรวมที่เปรียบเทียบอยู่ในช่วงคลาดเคลื่อน 0.01 USD",
    };
    const { error } = await db.from("do_billing_reconciliations").upsert(recon, { onConflict: "run_key" });
    if (error) throw new Error("DIGITALOCEAN_RECONCILIATION_WRITE_FAILED");
    return NextResponse.json({ ok: true, run_key: runKey, period_start: startDate, period_end: endDate, status, sku_count: insights.length, invoice_count: invoices.length, has_invoice_preview: Boolean(invoicePreview), provider_total_usd: recon.provider_insights_total_usd, gateway_estimate_usd: gatewayEstimate, variance_usd: recon.variance_usd, billing_history_count: history.length, responsibility_registry: responsibilityWarnings.length ? "incomplete" : "updated", responsibility_warnings: responsibilityWarnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DIGITALOCEAN_RECONCILIATION_FAILED";
    const status = message === "DIGITALOCEAN_BALANCE_GATE_BLOCKED" ? 402
      : error instanceof DigitalOceanRateLimitError ? 429
      : message.includes("CREDENTIAL_MISSING") || message.includes("ACCOUNT_URN_MISSING") || message.includes("BALANCE_GATE_UNAVAILABLE") || message.includes("RATE_LIMITER_UNAVAILABLE") ? 503 : 502;
    const headers = error instanceof DigitalOceanRateLimitError ? { "Retry-After": String(error.retryAfterSeconds) } : undefined;
    return NextResponse.json({ ok: false, code: message }, { status, headers });
  }
}

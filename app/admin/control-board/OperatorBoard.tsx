"use client";

import { useCallback, useEffect, useState } from "react";

type EngineSnapshot = {
  observed_at: string;
  overall: "healthy" | "attention" | "unknown";
  sources: {
    core_ledger: "available" | "unavailable";
    gateway_observation: "available" | "unavailable";
    health_checks: "available" | "unavailable";
    cloudflare_queue_depth: "not_instrumented";
  };
  metrics: {
    events_24h: number | null;
    succeeded_24h: number | null;
    failed_24h: number | null;
    processing_now: number | null;
    expired_processing_leases: number | null;
    gateway_events_1h: number | null;
  };
  health_checks: Array<{ service_key: string; status: string; consecutive_failures: number; last_check_at: string | null }>;
  recent_executions: Array<{
    event_id: string;
    source: string;
    event_type: string;
    capability_id: string;
    status: string;
    attempt_count: number;
    error_code: string | null;
    created_at: string;
    processed_at: string | null;
  }>;
  recent_ingress: Array<{ provider: string; capability: string; action: string; received_at: string }>;
};

type RouteNode = {
  node_key: string;
  node_type: string;
  name: string;
  status: string;
  status_detail: string;
  source_path: string | null;
  source_line_start: number | null;
  source_line_end: number | null;
  metadata: Record<string, unknown>;
};

type RouteEdge = {
  edge_key: string;
  source_node_key: string;
  target_node_key: string;
  edge_type: string;
  status: string;
  label: string;
  source_path: string | null;
  source_line_start: number | null;
  source_line_end: number | null;
  evidence: Record<string, unknown>;
};

type RouteMap = {
  map: { map_version: string; source_revision: string; created_at: string; node_count: number; edge_count: number };
  nodes: RouteNode[];
  edges: RouteEdge[];
  status_basis: string;
};

type DigitalOceanSnapshot = {
  observed_at: string;
  metrics: { api_calls_24h: number; blocked_calls_24h: number; catalog_rows: number };
  latest_reconciliation: null | {
    period_start: string; period_end: string; account_balance_usd: number | null;
    prepayment_balance_usd: number | null; prepayment_blocked: boolean | null;
    month_to_date_usage_usd: number | null; provider_insights_total_usd: number | null;
    gateway_estimated_cost_usd: number; variance_usd: number | null; status: string;
    detail: string | null; created_at: string;
    sku_insights: Array<{ sku?: string; description?: string; total_amount?: string; start_date?: string; region?: string }>;
  };
  reconciliation_history: Array<{ run_key: string; period_start: string; period_end: string; provider_insights_total_usd: number | null; gateway_estimated_cost_usd: number; variance_usd: number | null; status: string; created_at: string }>;
  recent_invoices: Array<{ invoice_uuid: string; invoice_id: string | null; invoice_period: string | null; amount_usd: number | null; updated_at: string | null; is_preview: boolean; fetched_at: string }>;
  recent_usage: Array<{ request_id: string; operation: string; api_path: string; status_code: number | null; outcome: string; latency_ms: number | null; created_at: string; error_code: string | null }>;
  status_basis: string;
};

function numberText(value: number | null) {
  return value === null ? "ไม่ทราบ" : value.toLocaleString("th-TH");
}

function timeText(value: string | null) {
  if (!value) return "ยังไม่มีข้อมูล";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "เวลาไม่ถูกต้อง" : date.toLocaleString("th-TH");
}

function StatusChip({ status }: { status: string }) {
  const classes = status === "healthy" || status === "succeeded" || status === "matched" || status === "production_verified"
    ? "bg-emerald-100 text-emerald-800"
    : status === "attention" || status === "failed" || status === "degraded" || status === "discrepancy" || status === "blocked"
      ? "bg-red-100 text-red-800"
      : status === "processing" || status === "incomplete"
        ? "bg-amber-100 text-amber-800"
        : "bg-stone-100 text-stone-700";
  const labels: Record<string, string> = {
    healthy: "ปกติจากข้อมูลที่ตรวจได้", attention: "ต้องตรวจสอบ", unknown: "ยังวัดไม่ได้",
    succeeded: "สำเร็จ", failed: "ผิดพลาด", processing: "กำลังทำงาน", degraded: "มีปัญหา",
    not_instrumented: "ยังไม่มีตัววัด", available: "อ่านข้อมูลได้", unavailable: "อ่านข้อมูลไม่ได้",
    source_wired: "มีทางเชื่อมในซอร์ส · ยังไม่ยืนยัน Production",
    production_unverified: "ยังไม่ยืนยันการทำงานบน Production",
    production_verified: "ยืนยันทำงานบน Production แล้ว",
    missing_handler: "ยังไม่มี Handler ที่เชื่อมกับ Core",
    blocked: "เส้นทางหยุดตรงนี้",
    matched: "ยอดรวมใกล้เคียงกัน",
    discrepancy: "พบส่วนต่าง",
    incomplete: "ข้อมูลยังไม่ครบ",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${classes}`}>{labels[status] ?? status}</span>;
}

function MetricCard({ title, value, detail, status }: { title: string; value: number | string; detail: string; status?: string }) {
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-medium text-stone-600">{title}</h2>
        {status && <StatusChip status={status} />}
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums text-stone-900">{value}</p>
      <p className="mt-1 text-xs leading-5 text-stone-500">{detail}</p>
    </article>
  );
}

export default function OperatorBoard() {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [routeMap, setRouteMap] = useState<RouteMap | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(true);
  const [digitalOcean, setDigitalOcean] = useState<DigitalOceanSnapshot | null>(null);
  const [digitalOceanError, setDigitalOceanError] = useState<string | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogRefreshMessage, setCatalogRefreshMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/control-board", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; snapshot?: EngineSnapshot; code?: string };
      if (!response.ok || !data.snapshot) throw new Error(data.code ?? `HTTP_${response.status}`);
      setSnapshot(data.snapshot);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CONTROL_BOARD_UNAVAILABLE");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshRoutes = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/control-board/routes", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; route_map?: RouteMap; code?: string };
      if (!response.ok || !data.route_map) throw new Error(data.code ?? `HTTP_${response.status}`);
      setRouteMap(data.route_map);
      setRouteError(null);
    } catch (caught) {
      setRouteMap(null);
      setRouteError(caught instanceof Error ? caught.message : "ROUTE_MAP_UNAVAILABLE");
    } finally {
      setRouteLoading(false);
    }
  }, []);

  const refreshDigitalOcean = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/control-board/digitalocean", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; code?: string } & Partial<DigitalOceanSnapshot>;
      if (!response.ok || !data.metrics) throw new Error(data.code ?? `HTTP_${response.status}`);
      setDigitalOcean(data as DigitalOceanSnapshot);
      setDigitalOceanError(null);
    } catch (caught) {
      setDigitalOcean(null);
      setDigitalOceanError(caught instanceof Error ? caught.message : "DIGITALOCEAN_METER_UNAVAILABLE");
    }
  }, []);

  const refreshDigitalOceanCatalog = useCallback(async () => {
    setCatalogRefreshing(true);
    setCatalogRefreshMessage(null);
    try {
      const response = await fetch("/api/admin/digitalocean/catalog", {
        method: "POST",
        headers: { "Idempotency-Key": `operator-catalog-${crypto.randomUUID()}` },
      });
      const data = await response.json() as { ok?: boolean; code?: string; counts?: { droplet_sizes: number; one_click_apps: number; regions: number; database_options: number } };
      if (!response.ok || !data.ok || !data.counts) throw new Error(data.code ?? `HTTP_${response.status}`);
      setCatalogRefreshMessage(`ดึงแล้ว: Droplet ${data.counts.droplet_sizes} · One-click ${data.counts.one_click_apps} · Regions ${data.counts.regions} · Database ${data.counts.database_options}`);
      await refreshDigitalOcean();
    } catch (caught) {
      setCatalogRefreshMessage(`ดึง Catalog ไม่สำเร็จ: ${caught instanceof Error ? caught.message : "DIGITALOCEAN_CATALOG_REFRESH_FAILED"}`);
    } finally {
      setCatalogRefreshing(false);
    }
  }, [refreshDigitalOcean]);

  useEffect(() => {
    void refresh();
    void refreshRoutes();
    void refreshDigitalOcean();
    const timer = window.setInterval(() => { void refresh(); void refreshRoutes(); void refreshDigitalOcean(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, refreshRoutes, refreshDigitalOcean]);

  const overall = snapshot?.overall ?? "unknown";
  return (
    <main className="mx-auto min-h-full max-w-7xl p-5 sm:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-stone-200 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Economic & Operational Control Plane</p>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">Operator Control Board</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">แผงเฝ้าการทำงานแบบเครื่องต่อเครื่อง แสดงเฉพาะหลักฐานจาก event ledger, gateway และ health check ที่อ่านได้ ไม่มีปุ่มอนุมัติธุรกรรม</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusChip status={overall} />
          <button type="button" onClick={() => void refresh()} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700">ตรวจตอนนี้</button>
        </div>
      </header>

      {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">อ่านสถานะล่าสุดไม่ได้: {error}</div>}
      {loading && !snapshot && <p className="mb-5 text-sm text-stone-500">กำลังอ่านหลักฐานการทำงานจริง…</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="เหตุการณ์ใน 24 ชั่วโมง" value={numberText(snapshot?.metrics.events_24h ?? null)} detail="จำนวนที่ลงใน Core Event Ledger" status={snapshot?.sources.core_ledger ?? "unknown"} />
        <MetricCard title="ประมวลผลสำเร็จ" value={numberText(snapshot?.metrics.succeeded_24h ?? null)} detail="สถานะ succeeded ใน 24 ชั่วโมง" />
        <MetricCard title="ประมวลผลผิดพลาด" value={numberText(snapshot?.metrics.failed_24h ?? null)} detail="สถานะ failed ใน 24 ชั่วโมง" status={snapshot?.metrics.failed_24h == null ? "unknown" : snapshot.metrics.failed_24h > 0 ? "attention" : "healthy"} />
        <MetricCard title="งานค้างเกินสัญญาเวลา" value={numberText(snapshot?.metrics.expired_processing_leases ?? null)} detail="processing ที่ lease หมดอายุแล้ว" status={snapshot?.metrics.expired_processing_leases == null ? "unknown" : snapshot.metrics.expired_processing_leases > 0 ? "attention" : "healthy"} />
      </section>

      <section className="mt-6 grid gap-3 lg:grid-cols-2">
        <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-stone-900">สุขภาพท่อและแหล่งข้อมูล</h2>
          <p className="mt-1 text-xs text-stone-500">อ่านสถานะเมื่อ {timeText(snapshot?.observed_at ?? null)} · รีเฟรชอัตโนมัติทุก 15 วินาที</p>
          <div className="mt-4 divide-y divide-stone-100">
            <div className="flex items-center justify-between py-3 text-sm"><span>Core Event Ledger</span><StatusChip status={snapshot?.sources.core_ledger ?? "unknown"} /></div>
            <div className="flex items-center justify-between py-3 text-sm"><span>Gateway Event Log</span><StatusChip status={snapshot?.sources.gateway_observation ?? "unknown"} /></div>
            <div className="flex items-center justify-between py-3 text-sm"><span>Health Check ล่าสุด</span><StatusChip status={snapshot?.sources.health_checks ?? "unknown"} /></div>
            <div className="flex items-center justify-between py-3 text-sm"><span>ความลึกคิว Cloudflare</span><StatusChip status="not_instrumented" /></div>
          </div>
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-xs leading-5 text-amber-900">ความลึกคิวและจำนวน retry ของ Cloudflare ยังไม่มีตัวอ่านในโค้ดปัจจุบัน จึงแสดงว่า “ยังไม่มีตัววัด” แทนการสรุปว่าคิวปกติ</p>
        </article>

        <article className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-stone-900">Health checks ที่บันทึกไว้</h2>
          {!snapshot?.health_checks.length ? <p className="mt-4 text-sm text-stone-500">ไม่มี health check ที่อ่านได้ในขณะนี้</p> : (
            <div className="mt-3 divide-y divide-stone-100">
              {snapshot.health_checks.map((row) => <div key={row.service_key} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div><p className="font-medium text-stone-800">{row.service_key}</p><p className="text-xs text-stone-500">ตรวจล่าสุด {timeText(row.last_check_at)} · ล้มเหลวต่อเนื่อง {row.consecutive_failures} ครั้ง</p></div>
                <StatusChip status={row.status} />
              </div>)}
            </div>
          )}
        </article>
      </section>

      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-4">
          <div>
            <h2 className="font-semibold text-stone-900">แผนที่เส้นทางและจุดที่ยังขาด</h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">อ่านจาก schema system ในฐานข้อมูล DNA OS โปรเจกต์เดียว · แผนที่นี้บอกสิ่งที่ต่อไว้ในซอร์สและส่วนที่ยังไม่มี Handler</p>
          </div>
          {routeMap && <div className="text-right text-xs text-stone-500">{routeMap.map.map_version}<br />{routeMap.map.node_count} จุด · {routeMap.map.edge_count} เส้น</div>}
        </div>

        {routeLoading && !routeMap ? <p className="py-5 text-sm text-stone-500">กำลังอ่าน Route Map จาก schema system…</p> : routeError ? (
          <div role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">ยังอ่านแผนที่จาก schema system ไม่ได้: {routeError}</p>
            <p className="mt-1 text-xs leading-5">จึงยังแสดงเส้นทางจริงจาก Graph ไม่ได้ ต้องมีตาราง Route Map ใน schema system และเปิดสิทธิ์เฉพาะ service role ก่อน</p>
          </div>
        ) : routeMap ? (() => {
          const byKey = new Map(routeMap.nodes.map((node) => [node.node_key, node]));
          const mainRoute = ["line_webhook_v2", "core_events_ingress", "dnaos_core_events", "central_brain_execute"]
            .map((key) => byKey.get(key)).filter((node): node is RouteNode => Boolean(node));
          const branches = [
            { title: "Handlers ที่มีในเส้นทาง", keys: ["conversation_answer", "event_builder"] },
            { title: "จุดที่ยังขาดสำหรับงานซื้อขาย", keys: ["order_intent_handler", "finance_handler", "stock_handler", "transport_handler"] },
          ];
          const sourceRef = (path: string | null, start: number | null, end: number | null) => path ? `${path}${start ? `:${start}${end && end !== start ? `–${end}` : ""}` : ""}` : null;
          return <>
            <div className="mt-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">LINE ขาเข้า → คิว → สมองกลาง</p>
              <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-stretch">
                {mainRoute.map((node, index) => {
                  const next = mainRoute[index + 1];
                  const edge = next ? routeMap.edges.find((item) => item.source_node_key === node.node_key && item.target_node_key === next.node_key) : null;
                  return <div key={node.node_key} className="flex min-w-0 flex-1 flex-col items-stretch gap-2 lg:flex-row lg:items-center">
                    <article className={`min-w-0 flex-1 rounded-lg border p-3 ${node.status === "production_verified" ? "border-emerald-300 bg-emerald-50" : node.status === "missing_handler" ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-stone-900">{node.name}</p><StatusChip status={node.status} /></div>
                      <p className="mt-2 text-xs leading-5 text-stone-600">{node.status_detail}</p>
                      {sourceRef(node.source_path, node.source_line_start, node.source_line_end) && <p className="mt-2 break-all font-mono text-[10px] text-stone-500">{sourceRef(node.source_path, node.source_line_start, node.source_line_end)}</p>}
                    </article>
                    {next && <div className="flex shrink-0 flex-col items-center text-stone-400" aria-label={edge?.label ?? "เส้นทาง"}><span className="text-lg leading-none lg:hidden">↓</span><span className="hidden text-lg leading-none lg:block">→</span>{edge && <span className="max-w-28 text-center text-[10px] leading-4 text-stone-500">{edge.label}<br /><StatusChip status={edge.status} /></span>}</div>}
                  </div>;
                })}
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {branches.map((branch) => <div key={branch.title} className="rounded-lg border border-stone-200 p-4">
                <h3 className="text-sm font-semibold text-stone-800">{branch.title}</h3>
                <div className="mt-3 space-y-3">{branch.keys.map((key) => {
                  const node = byKey.get(key);
                  if (!node) return null;
                  const connectedFrom = routeMap.edges.find((edge) => edge.target_node_key === key);
                  const requires = routeMap.edges.filter((edge) => edge.source_node_key === key && edge.edge_type === "REQUIRES_HANDLER");
                  return <article key={key} className={`rounded-md border p-3 ${node.status === "production_verified" ? "border-emerald-300 bg-emerald-50" : node.status === "missing_handler" ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-stone-900">{node.name}</p><StatusChip status={node.status} /></div>
                    <p className="mt-1 text-xs leading-5 text-stone-600">{node.status_detail}</p>
                    {connectedFrom && <p className="mt-2 text-xs text-stone-500">← {byKey.get(connectedFrom.source_node_key)?.name ?? connectedFrom.source_node_key} · {connectedFrom.label} <StatusChip status={connectedFrom.status} /></p>}
                    {requires.map((edge) => <p key={edge.edge_key} className="mt-2 text-xs text-red-800">→ {byKey.get(edge.target_node_key)?.name ?? edge.target_node_key}: {edge.label}</p>)}
                    {sourceRef(node.source_path, node.source_line_start, node.source_line_end) && <p className="mt-2 break-all font-mono text-[10px] text-stone-500">{sourceRef(node.source_path, node.source_line_start, node.source_line_end)}</p>}
                  </article>;
                })}</div>
              </div>)}
            </div>
            <p className="mt-4 rounded-md bg-stone-50 p-3 text-xs leading-5 text-stone-600">สีเขียวจะแสดงเฉพาะเมื่อ Graph บันทึกหลักฐาน `production_verified` เท่านั้น ขณะนี้ท่อในซอร์สยังไม่ยืนยันการทำงานจริงบน Production; ข้อความในแชตอาจถูกตอบได้ แต่ยังไม่มี Handler ที่แปลงคำสั่งซื้อไปเป็นรายการซื้อขาย การเงิน การตัดสต๊อก หรือจองคิวรถ</p>
          </>;
        })() : null}
      </section>

      <section className="mt-6 grid gap-3 xl:grid-cols-2">
        <article className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 p-4"><h2 className="font-semibold text-stone-900">รายการประมวลผลล่าสุด</h2><p className="mt-1 text-xs text-stone-500">ไม่แสดงเนื้อหาข้อความหรือผลลัพธ์ที่อาจมีข้อมูลธุรกิจ</p></div>
          {!snapshot?.recent_executions.length ? <p className="p-4 text-sm text-stone-500">ยังไม่มีรายการใน ledger</p> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-stone-50 text-stone-500"><tr><th className="p-3">เวลา</th><th className="p-3">ที่มา / เหตุการณ์</th><th className="p-3">ความสามารถ</th><th className="p-3">สถานะ</th><th className="p-3">ข้อผิดพลาด</th></tr></thead><tbody className="divide-y divide-stone-100">{snapshot.recent_executions.map((row) => <tr key={row.event_id}><td className="p-3 whitespace-nowrap">{timeText(row.created_at)}</td><td className="p-3">{row.source} · {row.event_type}</td><td className="p-3 font-mono">{row.capability_id}</td><td className="p-3"><StatusChip status={row.status} /></td><td className="p-3 font-mono text-red-700">{row.error_code ?? "—"}</td></tr>)}</tbody></table></div>}
        </article>

        <article className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 p-4"><h2 className="font-semibold text-stone-900">สัญญาณขาเข้าล่าสุด</h2><p className="mt-1 text-xs text-stone-500">Gateway event log เป็นหลักฐานการรับ ไม่ได้ยืนยันว่าประมวลผลเสร็จ</p></div>
          {!snapshot?.recent_ingress.length ? <p className="p-4 text-sm text-stone-500">ยังไม่มี event ที่อ่านได้</p> : <div className="divide-y divide-stone-100">{snapshot.recent_ingress.map((row, index) => <div key={`${row.provider}:${row.received_at}:${index}`} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><div><p className="font-medium text-stone-800">{row.provider} · {row.capability}</p><p className="text-xs text-stone-500">{row.action}</p></div><time className="text-xs text-stone-500">{timeText(row.received_at)}</time></div>)}</div>}
        </article>
      </section>

      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-4">
          <div><h2 className="font-semibold text-stone-900">DigitalOcean · Meter และกระทบยอด</h2><p className="mt-1 text-xs text-stone-500">ทุกคำขอของฟีเจอร์นี้ถูกบันทึกก่อน/หลังผ่าน Gateway · อ่านล่าสุด {timeText(digitalOcean?.observed_at ?? null)}</p></div>
          <button type="button" onClick={() => void refreshDigitalOceanCatalog()} disabled={catalogRefreshing} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 disabled:opacity-50">{catalogRefreshing ? "กำลังดึง Catalog…" : "ดึง Catalog ล่าสุด"}</button>
          {digitalOcean?.latest_reconciliation && <StatusChip status={digitalOcean.latest_reconciliation.status} />}
        </div>
        {catalogRefreshMessage && <p role="status" className="mt-3 rounded-md bg-stone-50 p-2 text-xs text-stone-700">{catalogRefreshMessage}</p>}
        {digitalOceanError ? <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">ยังอ่าน Meter ได้ไม่ครบ: {digitalOceanError} · ตรวจ Migration, System Vault token และการตั้งค่า account URN</p> : digitalOcean ? <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="คำขอ DigitalOcean ใน 24 ชม." value={numberText(digitalOcean.metrics.api_calls_24h)} detail="นับทั้งคำขอ API และการตรวจ prepayment gate" />
            <MetricCard title="ถูกกั้นก่อนเรียก API" value={numberText(digitalOcean.metrics.blocked_calls_24h)} detail="รวม prepayment blocked และ gate ที่อ่านไม่ได้" status={digitalOcean.metrics.blocked_calls_24h ? "attention" : "healthy"} />
            <MetricCard title="รายการ Catalog" value={numberText(digitalOcean.metrics.catalog_rows)} detail="ขนาด Droplet, One-click Apps, Regions และ Database Options" />
            <MetricCard title="ยอดใช้ MTD จาก DO" value={digitalOcean.latest_reconciliation?.month_to_date_usage_usd == null ? "ยังไม่มี" : `$${digitalOcean.latest_reconciliation.month_to_date_usage_usd.toFixed(2)}`} detail={digitalOcean.latest_reconciliation ? `Prepayment $${digitalOcean.latest_reconciliation.prepayment_balance_usd?.toFixed(2) ?? "—"} · ${digitalOcean.latest_reconciliation.prepayment_blocked == null ? "ไม่รายงานสถานะกั้น" : digitalOcean.latest_reconciliation.prepayment_blocked ? "DO กั้นการใช้จ่าย" : "DO ไม่กั้นการใช้จ่าย"}` : "รอรอบกระทบยอดแรก"} status={digitalOcean.latest_reconciliation?.prepayment_blocked ? "blocked" : undefined} />
          </div>
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">ยอดที่เรียกเก็บจากผู้ใช้ DNA OS: ยังแสดงไม่ได้ เพราะยังไม่มี Wallet/บัญชีลูกค้าและรายการจองเงินที่เชื่อมกับ SKU หรือทรัพยากร DigitalOcean ตัวเลขนี้จึงเป็น “ไม่มีข้อมูลเชื่อมโยง” ไม่ใช่ยอดศูนย์</p>
          {digitalOcean.latest_reconciliation ? <div className="mt-5 rounded-lg border border-stone-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-stone-900">ผลกระทบยอด {digitalOcean.latest_reconciliation.period_start}</h3><span className="text-xs text-stone-500">ตรวจเมื่อ {timeText(digitalOcean.latest_reconciliation.created_at)}</span></div>
            <p className="mt-2 text-sm text-stone-700">DO ตาม SKU: <b>${digitalOcean.latest_reconciliation.provider_insights_total_usd?.toFixed(2) ?? "—"}</b> · ต้นทุนทรัพยากรที่ Gateway ประเมิน: <b>${digitalOcean.latest_reconciliation.gateway_estimated_cost_usd.toFixed(2)}</b> · ส่วนต่างรวม: <b>{digitalOcean.latest_reconciliation.variance_usd == null ? "ยังคำนวณไม่ได้" : `$${digitalOcean.latest_reconciliation.variance_usd.toFixed(2)}`}</b></p>
            {digitalOcean.latest_reconciliation.detail && <p className="mt-2 text-xs leading-5 text-stone-600">{digitalOcean.latest_reconciliation.detail}</p>}
            <p className="mt-2 rounded bg-amber-50 p-2 text-xs leading-5 text-amber-900">ยอด DO เป็นรายวัน/ตาม SKU ไม่ใช่ราคาต่อ API call ดังนั้นส่วนต่างนี้เป็นการเทียบยอดรวมกับต้นทุนที่ Gateway ระบุได้ ยังไม่ใช่การจับคู่ทรัพยากรกับคำขอแต่ละรายการ</p>
            {!!digitalOcean.latest_reconciliation.sku_insights?.length && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-stone-50 text-stone-500"><tr><th className="p-2">SKU</th><th className="p-2">รายการ</th><th className="p-2">พื้นที่</th><th className="p-2 text-right">USD</th></tr></thead><tbody className="divide-y divide-stone-100">{digitalOcean.latest_reconciliation.sku_insights.slice(0, 12).map((row, index) => <tr key={`${row.sku ?? "sku"}:${index}`}><td className="p-2 font-mono">{row.sku ?? "—"}</td><td className="p-2">{row.description ?? "—"}</td><td className="p-2">{row.region ?? "—"}</td><td className="p-2 text-right">${Number(row.total_amount ?? 0).toFixed(2)}</td></tr>)}</tbody></table></div>}
          </div> : <p className="mt-4 text-sm text-stone-500">ยังไม่มีผลกระทบยอดรายวัน</p>}
          {!!digitalOcean.recent_usage.length && <div className="mt-5 overflow-x-auto"><h3 className="mb-2 text-sm font-semibold text-stone-800">คำขอ API ล่าสุด</h3><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-stone-50 text-stone-500"><tr><th className="p-2">เวลา</th><th className="p-2">งาน</th><th className="p-2">เส้นทาง</th><th className="p-2">HTTP</th><th className="p-2">ผล</th><th className="p-2">ms</th></tr></thead><tbody className="divide-y divide-stone-100">{digitalOcean.recent_usage.map((row) => <tr key={row.request_id}><td className="p-2 whitespace-nowrap">{timeText(row.created_at)}</td><td className="p-2">{row.operation}</td><td className="p-2 font-mono">{row.api_path}</td><td className="p-2">{row.status_code ?? "—"}</td><td className="p-2"><StatusChip status={row.outcome} />{row.error_code ? ` ${row.error_code}` : ""}</td><td className="p-2">{row.latency_ms ?? "—"}</td></tr>)}</tbody></table></div>}
          {!!digitalOcean.recent_invoices.length && <div className="mt-5 overflow-x-auto"><h3 className="mb-2 text-sm font-semibold text-stone-800">ใบแจ้งหนี้จาก DigitalOcean</h3><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-stone-50 text-stone-500"><tr><th className="p-2">รอบบิล</th><th className="p-2">เลขที่</th><th className="p-2">UUID</th><th className="p-2 text-right">USD</th><th className="p-2">ชนิด</th></tr></thead><tbody className="divide-y divide-stone-100">{digitalOcean.recent_invoices.map((invoice) => <tr key={invoice.invoice_uuid}><td className="p-2">{invoice.invoice_period ?? "—"}</td><td className="p-2">{invoice.invoice_id ?? "—"}</td><td className="p-2 font-mono">{invoice.invoice_uuid}</td><td className="p-2 text-right">{invoice.amount_usd == null ? "—" : `$${invoice.amount_usd.toFixed(2)}`}</td><td className="p-2">{invoice.is_preview ? "ตัวอย่างปัจจุบัน" : "ใบแจ้งหนี้"}</td></tr>)}</tbody></table><p className="mt-2 text-xs text-stone-500">จัดเก็บเฉพาะเลขอ้างอิงและสรุปยอด ไม่บันทึกชื่อ อีเมล หรือที่อยู่ใบแจ้งหนี้</p></div>}
          <p className="mt-3 text-xs leading-5 text-stone-500">{digitalOcean.status_basis}</p>
        </> : <p className="mt-4 text-sm text-stone-500">กำลังอ่านข้อมูล Meter…</p>}
      </section>
      <footer className="mt-6 rounded-lg bg-stone-100 p-4 text-xs leading-5 text-stone-600">แผงนี้ใช้ดูสถานะเท่านั้น โดยข้อมูลระบบและข้อมูลธุรกิจอยู่ใน Supabase โปรเจกต์เดียวแต่แยก schema การทำงานอัตโนมัติที่มีผลต่อเงิน สต๊อก หรือคำสั่งซื้อยังไม่มี handler ครบตามแต่ละสัญญา จึงไม่รายงานว่าเปิดใช้งานแล้ว</footer>
    </main>
  );
}

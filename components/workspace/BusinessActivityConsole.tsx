"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Building2, CalendarDays, FileText, Link2, LoaderCircle, PlugZap, Search, ShoppingBag, Wallet, Truck } from "lucide-react";
import Link from "next/link";

type Company = { id: string; name: string; type?: string | null; organization_id: string };
type Activity = {
  kind: string; source_table: string; source_id: string; occurred_at: string | null;
  status: string | null; company_id: string | null; company_name: string | null;
  title: string; detail: unknown; reference_id: string | null; related_ids?: unknown[];
  logistics_reference?: string | null;
};
type Payload = { ok?: boolean; code?: string; companies?: Company[]; items?: Activity[]; total?: number };

const categories = [
  { id: "all", label: "เส้นเรื่องทั้งหมด", icon: Link2 },
  { id: "events", label: "ช่องทางและเหตุการณ์", icon: Building2 },
  { id: "parties", label: "ลูกค้า/คู่ค้า", icon: Building2 },
  { id: "orders", label: "งานและคำสั่งซื้อ", icon: ShoppingBag },
  { id: "documents", label: "เอกสาร", icon: FileText },
  { id: "finance", label: "การเงินธุรกิจ", icon: Wallet },
  { id: "logistics", label: "โลจิสติกส์", icon: Truck },
] as const;

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString("th-TH");
  if (Array.isArray(value)) return value.map(String).join(", ");
  return JSON.stringify(value);
}

function dateLabel(value: string | null): string {
  if (!value) return "ไม่ระบุเวลา";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("th-TH");
}

export default function BusinessActivityConsole() {
  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ kind });
    if (q.trim()) params.set("q", q.trim());
    if (status.trim()) params.set("status", status.trim());
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (companyId) params.set("company_id", companyId);
    try {
      const response = await fetch(`/api/business/workspace?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as Payload;
      setMessage("");
      if (response.status === 409) {
        setCompanies([]); setItems([]); setMessage("เลือกองค์กรธุรกิจที่ยืนยันสิทธิ์แล้วจากแถบด้านบนก่อนดูข้อมูล");
      } else if (!response.ok || body.ok !== true) {
        setCompanies([]); setItems([]); setMessage("โหลดข้อมูลธุรกิจไม่สำเร็จ ระบบปิดการอ่านไว้จนกว่าจะตรวจขอบเขตได้");
      } else {
        setCompanies(Array.isArray(body.companies) ? body.companies : []);
        setItems(Array.isArray(body.items) ? body.items : []);
      }
    } catch {
      setMessage("ติดต่อระบบข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [kind, q, status, dateFrom, dateTo, companyId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    const onContextChanged = () => void load();
    window.addEventListener("dnaos-business-context-changed", onContextChanged);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("dnaos-business-context-changed", onContextChanged);
    };
  }, [load]);

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-5 sm:p-7">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-700">พื้นที่ทำงานธุรกิจ</p>
        <h1 className="text-2xl font-semibold text-ink">งานและหลักฐานขององค์กร</h1>
        <p className="max-w-3xl text-sm leading-6 text-ink-secondary">แสดงข้อมูลตามองค์กรที่เลือกและยืนยันจากสมาชิกองค์กร: ช่องทาง → ข้อความต้นทาง → เหตุการณ์ → คำสั่งซื้อ → เอกสาร → หลักฐานรับเงินหรือกำหนดส่ง โดยแสดงรหัสอ้างอิงจากแต่ละตาราง</p>
      </header>

      <section className="rounded-xl border border-hairline bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">หมวดงานธุรกิจ</h2>
          <span className="text-xs text-ink-muted">{companies.length} บริษัท/คู่ค้าในขอบเขตที่เลือก</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setKind(id)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${kind === id ? "border-emerald-700 bg-emerald-700 text-white" : "border-hairline bg-card text-ink-secondary hover:bg-subtle"}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border border-hairline bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="relative sm:col-span-2 lg:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-muted" /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="ค้นชื่อ เลขเอกสาร หรือรหัสอ้างอิง" className="w-full rounded-lg border border-hairline py-2 pl-9 pr-3 text-sm" /></label>
        <select aria-label="กรองบริษัท" value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="rounded-lg border border-hairline px-3 py-2 text-sm"><option value="">ทุกบริษัทในองค์กร</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select>
        <input aria-label="กรองสถานะ" value={status} onChange={(event) => setStatus(event.target.value)} placeholder="สถานะ" className="rounded-lg border border-hairline px-3 py-2 text-sm" />
        <div className="flex items-center gap-2 text-ink-muted"><CalendarDays className="h-4 w-4 shrink-0" /><input aria-label="ตั้งแต่วันที่" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="min-w-0 w-full rounded-lg border border-hairline px-2 py-2 text-xs" /><span>ถึง</span><input aria-label="ถึงวันที่" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="min-w-0 w-full rounded-lg border border-hairline px-2 py-2 text-xs" /></div>
      </section>

      {message && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</div>}

      <section className="overflow-hidden rounded-xl border border-hairline bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <div><h2 className="text-sm font-semibold text-ink">รายการและเส้นอ้างอิง</h2><p className="text-xs text-ink-muted">เรียงตามเวลาที่บันทึก · ไม่สร้างความสัมพันธ์ที่ไม่มีรหัสอ้างอิง</p></div>
          <span className="text-xs text-ink-muted">{items.length} รายการ</span>
        </div>
        {kind === "parties" ? <div className="divide-y divide-hairline">{companies.filter((company) => !q.trim() || `${company.name} ${company.id} ${company.type ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())).map((company) => <article key={company.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"><div><h3 className="text-sm font-medium text-ink">{company.name}</h3><p className="mt-1 text-xs text-ink-muted">{company.type ?? "บริษัท/คู่ค้า"}</p></div><span className="font-mono text-[10px] text-ink-muted">companies.id: {company.id}</span></article>)}{companies.length === 0 && <div className="p-8 text-center text-sm text-ink-muted">องค์กรนี้ยังไม่มีบริษัทหรือคู่ค้าในตาราง companies</div>}</div> : loading ? <div className="flex items-center gap-2 p-8 text-sm text-ink-muted"><LoaderCircle className="h-4 w-4 animate-spin" />กำลังอ่านข้อมูลในขอบเขตองค์กร…</div> : items.length === 0 ? <div className="p-8 text-center text-sm text-ink-muted">ไม่พบรายการในหมวดและตัวกรองนี้</div> : (
          <div className="divide-y divide-hairline">
            {items.map((item) => <article key={`${item.source_table}:${item.source_id}`} className="grid gap-2 px-4 py-4 md:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium text-ink">{display(item.title)}</h3><span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] text-ink-secondary">{item.source_table}</span>{item.status && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] text-sky-800">{display(item.status)}</span>}</div>
                <p className="mt-1 truncate text-xs text-ink-secondary">{item.company_name ? `${item.company_name} · ` : ""}{display(item.detail)}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-ink-muted">
                  <span>รายการ ID: {display(item.source_id)}</span>
                  {item.reference_id && <span>อ้างถึง ID: {display(item.reference_id)}</span>}
                  {item.related_ids?.map((id) => <span key={String(id)}>สัมพันธ์ ID: {display(id)}</span>)}
                  {item.logistics_reference && <span>กำหนดส่ง: {dateLabel(item.logistics_reference)}</span>}
                </div>
              </div>
              <time className="text-xs text-ink-muted md:text-right">{dateLabel(item.occurred_at)}</time>
            </article>)}
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-card p-4">
          <h2 className="text-sm font-semibold text-ink">รูปแบบเอกสารขององค์กร</h2>
          <p className="mt-1 text-xs leading-5 text-ink-secondary">ระบบปัจจุบันอ่านค่ารูปแบบเอกสารจากการตั้งค่ากลาง ไม่พบหลักฐานว่ามีค่าตั้งต้นแยกตามองค์กร จึงยังไม่เปิดให้แก้ในพื้นที่นี้</p>
          <p className="mt-2 text-[10px] text-amber-700">ต้องแยกเจ้าของค่าและสิทธิ์องค์กรในฐานข้อมูลก่อน</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-sky-950">บัญชีระบบและคอนเน็กเตอร์</h2><p className="mt-1 text-xs text-sky-800">จัดการแยกจากลูกค้า คำสั่งซื้อ เอกสาร และเงินของธุรกิจ</p></div><PlugZap className="h-5 w-5 text-sky-700" /></div>
          <Link href="/account/connections" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-sky-800 hover:underline">ไปยังบริการและปลั๊กอิน <ArrowUpRight className="h-3.5 w-3.5" /></Link>
        </div>
      </section>
    </main>
  );
}

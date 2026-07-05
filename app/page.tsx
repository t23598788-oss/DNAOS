'use client';
import { useState, useEffect, useCallback } from 'react';

type RowStatus = 'hold' | 'released' | 'pending';

interface MatrixRow {
  id: string;
  company_name: string;
  company_phone: string;
  webhook_url: string;
  client_name: string;
  deposit_amount: number;
  deposit_doc_number: string;
  driver_name: string;
  distance_km: number;
  quantity: number;
  delivered: number;
  status: RowStatus;
  project_name: string;
  job_status: string;
  created_at: string;
}

function fmtMoney(n: number) {
  if (n === 0) return null;
  return '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 0 });
}

function fmtNum(n: number) {
  return n.toLocaleString('th-TH');
}

function StatusPill({ status }: { status: RowStatus }) {
  if (status === 'hold') return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
      <span className="text-xs font-semibold whitespace-nowrap">Hold 🔒</span>
    </div>
  );
  if (status === 'released') return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
      <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
      <span className="text-xs font-semibold whitespace-nowrap">Released 🔓</span>
    </div>
  );
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-100 text-stone-500">
      <span className="w-2 h-2 rounded-full bg-stone-300 flex-shrink-0" />
      <span className="text-xs font-semibold whitespace-nowrap">รอดำเนินการ</span>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={copy}
      className="mt-1.5 text-[10px] px-2 py-0.5 rounded border border-stone-200 bg-stone-50 hover:bg-blue-50 hover:border-blue-200 text-stone-400 hover:text-blue-600 transition font-mono leading-relaxed whitespace-nowrap"
    >
      {copied ? '✓ คัดลอกแล้ว' : 'คัดลอก Webhook URL'}
    </button>
  );
}

export default function ControlCenter() {
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/control-center');
      const data = await res.json();
      setRows(data.rows ?? []);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(rowId: string, action: 'approve' | 'suspend') {
    const key = rowId + ':' + action;
    setActing(key);
    try {
      await fetch('/api/control-center', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: rowId, action }),
      });
      await load();
    } finally {
      setActing(null);
    }
  }

  const holdRows = rows.filter(r => r.status === 'hold');
  const releasedRows = rows.filter(r => r.status === 'released');
  const totalHold = holdRows.reduce((s, r) => s + r.deposit_amount, 0);

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <span className="font-bold text-stone-800 tracking-tight">DNA OS</span>
          <span className="text-stone-200 select-none">|</span>
          <span className="text-sm text-stone-500 font-medium">Control Center</span>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-stone-400 tabular-nums">
              {lastUpdated.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 disabled:opacity-40 transition font-medium"
          >
            {loading ? 'โหลด...' : '↺ รีเฟรช'}
          </button>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Live</span>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 max-w-screen-2xl mx-auto">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-stone-200 px-5 py-4 shadow-sm">
            <div className="text-xs text-stone-400 font-medium mb-1 uppercase tracking-wider">งานทั้งหมด</div>
            <div className="text-3xl font-bold text-stone-800 tabular-nums">{rows.length}</div>
          </div>
          <div className="bg-amber-50 rounded-2xl border border-amber-200 px-5 py-4 shadow-sm">
            <div className="text-xs text-amber-600 font-medium mb-1 uppercase tracking-wider">Hold 🔒 เงินล็อกอยู่</div>
            <div className="text-3xl font-bold text-amber-700 tabular-nums">{holdRows.length}</div>
            {totalHold > 0 && (
              <div className="text-sm text-amber-600 mt-0.5">{fmtMoney(totalHold)}</div>
            )}
          </div>
          <div className="bg-emerald-50 rounded-2xl border border-emerald-200 px-5 py-4 shadow-sm">
            <div className="text-xs text-emerald-600 font-medium mb-1 uppercase tracking-wider">Released 🔓 ส่งสำเร็จ</div>
            <div className="text-3xl font-bold text-emerald-700 tabular-nums">{releasedRows.length}</div>
          </div>
        </div>

        {/* Matrix Table */}
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
          {loading && rows.length === 0 ? (
            <div className="py-24 text-center text-stone-400 text-sm animate-pulse">กำลังดึงข้อมูล...</div>
          ) : rows.length === 0 ? (
            <div className="py-24 text-center text-stone-400 text-sm">ยังไม่มีงานในระบบ</div>
          ) : (
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="border-b border-stone-100 bg-stone-50">
                  <th className="text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wider px-5 py-3 w-64">
                    บริษัทขนส่ง / LINE Webhook
                  </th>
                  <th className="text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wider px-5 py-3 w-48">
                    ผู้ว่าจ้าง
                  </th>
                  <th className="text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wider px-5 py-3 w-48">
                    คนขับ / งานจัดส่ง
                  </th>
                  <th className="text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wider px-5 py-3 w-40">
                    สถานะเงินกลาง
                  </th>
                  <th className="text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wider px-5 py-3 w-44">
                    การตัดสินใจ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-stone-50/60 transition-colors">

                    {/* Col 1: Transport company + webhook */}
                    <td className="px-5 py-4 align-top">
                      <div className="font-semibold text-stone-800 leading-tight">{row.company_name}</div>
                      {row.company_phone && (
                        <div className="text-xs text-stone-400 mt-0.5">{row.company_phone}</div>
                      )}
                      <div className="mt-2">
                        <div className="text-[10px] text-stone-300 font-mono truncate max-w-[220px] leading-relaxed">
                          {row.webhook_url.replace('https://', '')}
                        </div>
                        <CopyBtn text={row.webhook_url} />
                      </div>
                    </td>

                    {/* Col 2: Client/Employer */}
                    <td className="px-5 py-4 align-top">
                      <div className="font-semibold text-stone-800 leading-tight">{row.client_name}</div>
                      {row.deposit_amount > 0 ? (
                        <div className="mt-1.5 space-y-0.5">
                          <div className="text-xs text-stone-400">ยอดค้ำประกัน</div>
                          <div className="text-base font-bold text-stone-900 tabular-nums">
                            {fmtMoney(row.deposit_amount)}
                          </div>
                          {row.deposit_doc_number && (
                            <div className="text-[10px] text-stone-400 font-mono">{row.deposit_doc_number}</div>
                          )}
                        </div>
                      ) : (
                        <div className="text-xs text-stone-300 mt-1">ยังไม่มียอด</div>
                      )}
                    </td>

                    {/* Col 3: Driver + Job */}
                    <td className="px-5 py-4 align-top">
                      <div className="font-semibold text-stone-800 leading-tight">{row.driver_name}</div>
                      <div className="text-xs text-stone-500 mt-0.5 line-clamp-2">{row.project_name}</div>
                      <div className="flex flex-wrap gap-x-3 mt-1.5 text-xs text-stone-400 tabular-nums">
                        {row.distance_km > 0 && <span>{row.distance_km} กม.</span>}
                        {row.quantity > 0 && (
                          <span>{fmtNum(row.delivered)}/{fmtNum(row.quantity)} ม³</span>
                        )}
                      </div>
                    </td>

                    {/* Col 4: Escrow status */}
                    <td className="px-5 py-4 align-top">
                      <StatusPill status={row.status} />
                      <div className="text-[10px] text-stone-400 mt-1.5 font-mono tracking-tight">
                        {row.job_status}
                      </div>
                    </td>

                    {/* Col 5: Decision */}
                    <td className="px-5 py-4 align-top">
                      {row.status === 'hold' && (
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => act(row.id, 'approve')}
                            disabled={acting !== null}
                            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40 transition shadow-sm whitespace-nowrap"
                          >
                            {acting === row.id + ':approve' ? '...' : 'อนุมัติโอนเงิน ✓'}
                          </button>
                          <button
                            onClick={() => act(row.id, 'suspend')}
                            disabled={acting !== null}
                            className="px-4 py-2 bg-white text-red-600 border border-red-200 rounded-xl text-xs font-semibold hover:bg-red-50 active:bg-red-100 disabled:opacity-40 transition whitespace-nowrap"
                          >
                            {acting === row.id + ':suspend' ? '...' : 'ระงับจ่าย ✕'}
                          </button>
                        </div>
                      )}
                      {row.status === 'released' && (
                        <span className="text-xs text-emerald-600 font-semibold">โอนแล้ว ✓</span>
                      )}
                      {row.status === 'pending' && (
                        <span className="text-xs text-stone-400">รอยืนยัน</span>
                      )}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}

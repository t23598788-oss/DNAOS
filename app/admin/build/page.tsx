"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface BuildStatus {
  status: "clean" | "has_issues" | "not_built";
  status_th: string;
  generated_at: string | null;
  health: number;
  summary: {
    total: number; ok: number; broken: number; unused: number; unregistered: number;
  } | null;
}

interface BrokenModule {
  id: string;
  name_en: string;
  layer: string;
  status: string;
  error_th?: string;
}

function HealthRing({ pct }: { pct: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const fill = circ * (pct / 100);
  const color = pct >= 70 ? "#16a34a" : pct >= 40 ? "#ca8a04" : "#dc2626";
  return (
    <svg width={88} height={88} viewBox="0 0 88 88">
      <circle cx={44} cy={44} r={r} fill="none" stroke="#e5e7eb" strokeWidth={8} />
      <circle cx={44} cy={44} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 44 44)" />
      <text x={44} y={50} textAnchor="middle" fontSize={16} fontWeight="bold" fill={color}>
        {pct}%
      </text>
    </svg>
  );
}

export default function BuildPage() {
  const [data, setData] = useState<BuildStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [brokenModules, setBrokenModules] = useState<BrokenModule[]>([]);

  async function loadBroken() {
    try {
      const res = await fetch("/api/governance");
      if (!res.ok) return;
      const json = await res.json();
      const broken: BrokenModule[] = (json.nodes ?? []).filter(
        (n: any) => n.status === "BROKEN" || n.status === "UNREGISTERED"
      );
      setBrokenModules(broken);
    } catch {}
  }

  async function load() {
    setLoading(true);
    const res = await fetch("/api/build");
    setData(await res.json());
    setLoading(false);
    loadBroken();
  }

  async function triggerSync() {
    setSyncing(true);
    setSyncResult(null);
    const res = await fetch("/api/build", { method: "POST" });
    const json = await res.json();
    setSyncResult(json.status_th ?? json.error_th ?? "เสร็จแล้ว");
    setSyncing(false);
    load();
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-stone-800">Build</h1>
          <p className="text-[11px] text-stone-400">สถานะ Registry Sync และ Architecture Book</p>
        </div>
        <button
          onClick={triggerSync}
          disabled={syncing}
          className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition"
        >
          {syncing ? "กำลัง Sync…" : "↺ Sync Now"}
        </button>
      </div>

      <div className="p-6 space-y-4">
        {syncResult && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 text-sm text-violet-700">
            {syncResult}
          </div>
        )}

        {loading ? (
          <div className="text-stone-400 text-sm text-center py-8">กำลังโหลด…</div>
        ) : data ? (
          <>
            {/* Health */}
            <div className="bg-white border border-stone-200 rounded-xl p-5 flex items-center gap-6">
              <HealthRing pct={data.health} />
              <div>
                <div className="text-sm font-semibold text-stone-800">{data.status_th}</div>
                {data.generated_at ? (
                  <div className="text-[11px] text-stone-400 mt-1">
                    อัปเดต: {new Date(data.generated_at).toLocaleString("th-TH")}
                  </div>
                ) : (
                  <div className="text-[11px] text-red-500 mt-1">
                    ยังไม่มี architecture-book.json — กด Sync Now
                  </div>
                )}
              </div>
            </div>

            {/* Summary */}
            {data.summary && (
              <div className="grid grid-cols-5 gap-3">
                {[
                  { label: "ทั้งหมด",         value: data.summary.total,        color: "text-stone-700" },
                  { label: "ปกติ",             value: data.summary.ok,           color: "text-green-600" },
                  { label: "เสียหาย",          value: data.summary.broken,       color: "text-red-600" },
                  { label: "ไม่ได้ใช้",        value: data.summary.unused,       color: "text-yellow-600" },
                  { label: "ยังไม่ลงทะเบียน", value: data.summary.unregistered, color: "text-slate-500" },
                ].map((s) => (
                  <div key={s.label} className="bg-white border border-stone-200 rounded-xl p-4 text-center">
                    <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-[11px] text-stone-400 mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Broken modules list → links to Reader ── */}
            {brokenModules.length > 0 && (
              <div className="bg-white border border-red-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-red-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-red-700">
                    Module ที่มีปัญหา ({brokenModules.length})
                  </span>
                  <span className="text-[10px] text-stone-400">คลิกเพื่อเปิด Source</span>
                </div>
                <div className="divide-y divide-stone-100">
                  {brokenModules.map((m) => (
                    <div key={m.id} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-red-50/30 transition">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/reader?path=${encodeURIComponent(m.name_en)}`}
                          className="text-[11px] font-mono text-stone-700 hover:text-violet-700 hover:underline underline-offset-2 truncate block"
                        >
                          {m.name_en}
                        </Link>
                        {m.error_th && (
                          <p className="text-[11px] text-red-600 mt-0.5">⚠ {m.error_th}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] text-stone-400">{m.layer}</span>
                        <span className={`text-[10px] font-bold ${m.status === "BROKEN" ? "text-red-600" : "text-slate-500"}`}>
                          {m.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Command hints */}
            <div className="bg-stone-800 rounded-xl p-4 text-xs font-mono text-stone-300 space-y-1">
              <div><span className="text-violet-400">$</span> npm run sync</div>
              <div className="text-stone-500">— สแกน Source Code → อัปเดต Registry → สร้าง architecture-book.json</div>
              <div className="mt-2"><span className="text-violet-400">$</span> npm run watch</div>
              <div className="text-stone-500">— เปิด watcher อัปเดตอัตโนมัติทุกครั้งที่แก้ไขไฟล์</div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const METHOD_COLOR: Record<string, string> = {
  GET:    "bg-green-100 text-green-700",
  POST:   "bg-blue-100 text-blue-700",
  PUT:    "bg-amber-100 text-amber-700",
  PATCH:  "bg-orange-100 text-orange-700",
  DELETE: "bg-red-100 text-red-700",
};

interface Route {
  method: string;
  path: string;
  purpose_th: string | null;
  auth_required: boolean | null;
  source: string;
}

export default function ApiExplorerPage() {
  const router = useRouter();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedMethod, setSelectedMethod] = useState("ALL");
  const [testResult, setTestResult] = useState<{ path: string; status: number; data: any } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/routes");
      const json = await res.json();
      setRoutes(json.routes ?? []);
    } catch (e: any) {
      setError("โหลด API routes ไม่ได้: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = routes.filter((r) => {
    const matchMethod = selectedMethod === "ALL" || r.method === selectedMethod;
    const matchText = r.path.toLowerCase().includes(filter.toLowerCase()) ||
      (r.purpose_th ?? "").includes(filter);
    return matchMethod && matchText;
  });

  async function testApi(route: Route) {
    if (route.method !== "GET") return;
    const key = `${route.method}:${route.path}`;
    setTesting(key);
    setTestResult(null);
    try {
      const res = await fetch(route.path);
      const data = await res.json().catch(() => null);
      setTestResult({ path: route.path, status: res.status, data });
    } catch (e: any) {
      setTestResult({ path: route.path, status: 0, data: { error: e.message } });
    }
    setTesting(null);
  }

  const methods = ["ALL", ...Array.from(new Set(routes.map((r) => r.method))).sort()];

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-stone-800">API</h1>
          <p className="text-[11px] text-stone-400">
            {loading ? "กำลังสแกน…" : `${routes.length} routes จาก app/api/**/*.ts`}
          </p>
        </div>
        <button onClick={load} className="text-[11px] text-violet-600 hover:text-violet-800">
          ↺ Refresh
        </button>
      </div>

      <div className="p-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="ค้นหา path หรือคำอธิบาย…"
            className="flex-1 px-3 py-2 text-xs border border-stone-200 rounded-lg bg-white outline-none focus:border-violet-400"
          />
          <select
            value={selectedMethod}
            onChange={(e) => setSelectedMethod(e.target.value)}
            className="px-3 py-2 text-xs border border-stone-200 rounded-lg bg-white"
          >
            {methods.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>

        <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
          {loading && (
            <div className="px-4 py-6 text-center text-stone-400 text-sm">กำลังสแกน Source Code…</div>
          )}
          {!loading && filtered.map((r) => {
            const key = `${r.method}:${r.path}`;
            return (
              <div key={key} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50 transition group">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${METHOD_COLOR[r.method] ?? "bg-stone-100 text-stone-600"}`}>
                  {r.method}
                </span>
                <span className="text-xs font-mono text-stone-700 flex-1 truncate">{r.path}</span>
                <span className="text-[11px] text-stone-500 max-w-xs truncate">
                  {r.purpose_th ?? <span className="text-stone-300">—</span>}
                </span>
                {r.auth_required && (
                  <span className="text-[10px] text-amber-600 shrink-0">🔐</span>
                )}
                <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition">
                  {/* เปิด source ใน Reader */}
                  <button
                    onClick={() => router.push(`/admin/reader?path=${encodeURIComponent(r.source)}`)}
                    className="text-[10px] text-stone-400 hover:text-stone-700"
                    title="เปิด Source"
                  >
                    &lt;/&gt;
                  </button>
                  {/* ทดสอบ GET */}
                  {r.method === "GET" && (
                    <button
                      onClick={() => testApi(r)}
                      disabled={testing === key}
                      className="text-[10px] text-violet-600 hover:text-violet-800 disabled:opacity-40"
                    >
                      {testing === key ? "…" : "Test"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-stone-400 text-sm">
              ไม่พบ route ที่ตรงกัน
            </div>
          )}
        </div>

        {testResult && (
          <div className="bg-stone-900 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-stone-700">
              <span className="text-[11px] font-mono text-stone-300">{testResult.path}</span>
              <span className={`text-[11px] font-bold ${testResult.status >= 200 && testResult.status < 300 ? "text-green-400" : "text-red-400"}`}>
                {testResult.status}
              </span>
            </div>
            <pre className="p-4 text-xs text-green-400 font-mono overflow-auto max-h-72 whitespace-pre-wrap">
              {JSON.stringify(testResult.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

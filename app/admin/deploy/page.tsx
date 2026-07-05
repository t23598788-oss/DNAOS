"use client";

import { useState, useEffect } from "react";

interface DeployData {
  git: { hash: string; branch: string; message: string; author: string; date: string } | null;
  vercel: { projectId: string; orgId: string } | null;
  environment: string;
  platform: string;
  node_version: string;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-stone-100 last:border-0">
      <span className="text-[11px] text-stone-400 w-32 shrink-0">{label}</span>
      <span className="text-xs font-mono text-stone-700 break-all">{value}</span>
    </div>
  );
}

export default function DeployPage() {
  const [data, setData] = useState<DeployData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/deploy").then((r) => r.json()).then(setData).finally(() => setLoading(false));
  }, []);

  const envColor = {
    production: "bg-green-100 text-green-700",
    development: "bg-amber-100 text-amber-700",
    test: "bg-blue-100 text-blue-700",
  }[data?.environment ?? ""] ?? "bg-stone-100 text-stone-600";

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-4">
        <h1 className="text-base font-bold text-stone-800">Deploy</h1>
        <p className="text-[11px] text-stone-400">ข้อมูล Environment และ Git ปัจจุบัน</p>
      </div>

      <div className="p-6 space-y-4">
        {loading ? (
          <div className="text-stone-400 text-sm text-center py-8">กำลังโหลด…</div>
        ) : data ? (
          <>
            {/* Environment badge */}
            <div className="flex items-center gap-3">
              <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${envColor}`}>
                {data.environment}
              </span>
              <span className="text-[11px] text-stone-400">Node {data.node_version} · {data.platform}</span>
            </div>

            {/* Git */}
            {data.git ? (
              <div className="bg-white border border-stone-200 rounded-xl px-4 py-1">
                <div className="py-2 text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Git</div>
                <Row label="Branch" value={data.git.branch} />
                <Row label="Commit" value={data.git.hash} />
                <Row label="Message" value={data.git.message} />
                <Row label="Author" value={data.git.author} />
                <Row label="Date" value={new Date(data.git.date).toLocaleString("th-TH")} />
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                ไม่พบข้อมูล Git — ไม่ได้อยู่ใน Git Repository
              </div>
            )}

            {/* Vercel */}
            {data.vercel ? (
              <div className="bg-white border border-stone-200 rounded-xl px-4 py-1">
                <div className="py-2 text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Vercel</div>
                <Row label="Project ID" value={data.vercel.projectId} />
                <Row label="Org ID" value={data.vercel.orgId} />
              </div>
            ) : (
              <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 text-xs text-stone-400">
                ไม่พบ .vercel/project.json — ยังไม่ได้ deploy ขึ้น Vercel
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

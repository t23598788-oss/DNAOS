"use client";

import { useState, useCallback } from "react";

interface StorageResourceRow {
  path: string;
  size_bytes: number;
  state: string;
  classification: { classification: string; confidence: number; recommended_action: string; blocked_reason: string | null };
}

function human(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(1) + " KB";
}

async function call(command: string, params: Record<string, unknown> = {}) {
  const res = await fetch("/api/admin/storage-intelligence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, ...params }),
  });
  return res.json();
}

export default function StorageIntelligencePage() {
  const [scanRunId, setScanRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resources, setResources] = useState<StorageResourceRow[]>([]);
  const [reportData, setReportData] = useState<any>(null);
  const [dockerReport, setDockerReport] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<StorageResourceRow[] | null>(null);

  const runScan = useCallback(async () => {
    setBusy("scanning");
    setError(null);
    const r = await call("scan");
    if (!r.ok) { setError(r.error?.reason ?? "scan failed"); setBusy(null); return; }
    setScanRunId(r.scanRunId);
    setResources(r.resources);
    setBusy(null);
  }, []);

  const runClassify = useCallback(async () => {
    if (!scanRunId) return;
    setBusy("classifying");
    setError(null);
    const r = await call("classify", { scanRunId });
    if (!r.ok) { setError(r.error?.reason ?? "classify failed"); setBusy(null); return; }
    setResources(r.resources);
    const rep = await call("report", { scanRunId });
    if (rep.ok) setReportData(rep);
    setBusy(null);
  }, [scanRunId]);

  const runInspectDocker = useCallback(async () => {
    setBusy("docker");
    const r = await call("inspect_docker");
    if (r.ok) setDockerReport(r.result);
    setBusy(null);
  }, []);

  const runMoveSafe = useCallback(async (dryRun: boolean) => {
    if (!scanRunId) return;
    if (!dryRun && !confirm("ย้ายไฟล์ SAFE ทั้งหมดไปยัง macOS Trash จริง (ยังไม่ใช่การลบถาวร ยืนยันหรือไม่)?")) return;
    setBusy("moving");
    setError(null);
    const r = await call("move_safe_to_trash", { scanRunId, dryRun });
    if (!r.ok) { setError(r.error?.reason ?? "move failed"); setBusy(null); return; }
    if (!dryRun) setMoved(r.moved);
    setBusy(null);
  }, [scanRunId]);

  const safeItems = resources.filter((r) => r.state === "SAFE");
  const blockedItems = resources.filter((r) => r.state === "BLOCKED");
  const unknownItems = resources.filter((r) => r.classification.classification === "UNKNOWN");

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-800">Storage Intelligence</h1>
        <p className="text-sm text-stone-500 mt-1">
          ตรวจสอบและจัดการพื้นที่ SSD ของเครื่องพัฒนา — ย้ายเฉพาะไฟล์ที่ยืนยันปลอดภัยไปยัง macOS Trash เท่านั้น ไม่มีการลบถาวรจากหน้านี้
        </p>
      </div>

      {reportData && (
        <div className="grid grid-cols-4 gap-3">
          <Stat label="พื้นที่ว่าง" value={human(reportData.free_bytes)} />
          <Stat label="เป้าหมาย" value="150 GB" />
          <Stat label="ต้องคืนอีก" value={human(reportData.gap_bytes)} tone={reportData.gap_bytes > 0 ? "warn" : "ok"} />
          <Stat label="คืนได้จริง (SAFE)" value={human(reportData.total_safe_bytes)} tone="ok" />
        </div>
      )}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <Btn onClick={runScan} busy={busy === "scanning"}>Scan</Btn>
        <Btn onClick={runClassify} busy={busy === "classifying"} disabled={!scanRunId}>Classify + Verify</Btn>
        <Btn onClick={() => runMoveSafe(true)} busy={busy === "moving"} disabled={!scanRunId}>Create Reclaim Plan (dry-run)</Btn>
        <Btn onClick={() => runMoveSafe(false)} busy={busy === "moving"} disabled={safeItems.length === 0} tone="danger">Move Safe Items to Trash</Btn>
        <Btn onClick={runInspectDocker} busy={busy === "docker"}>Inspect Docker</Btn>
        <a href="file:///Users/tam/.Trash" className="text-sm text-stone-500 underline self-center">Open Trash</a>
      </div>

      {moved && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
          ย้ายไป Trash แล้ว {moved.length} รายการ — เปิด Finder → Trash เพื่อ Empty Trash เองเมื่อมั่นใจ
        </div>
      )}

      {dockerReport && (
        <ResourceSection title="Docker Resources (plan only — ไม่ prune อัตโนมัติ)">
          <pre className="text-xs bg-stone-50 border border-stone-200 rounded p-3 overflow-x-auto">{JSON.stringify(dockerReport, null, 2)}</pre>
        </ResourceSection>
      )}

      <ResourceSection title={`SAFE (${safeItems.length}) — trash-eligible`} tone="ok">
        <ResourceTable rows={safeItems} />
      </ResourceSection>
      <ResourceSection title={`BLOCKED (${blockedItems.length})`} tone="warn">
        <ResourceTable rows={blockedItems} showReason />
      </ResourceSection>
      <ResourceSection title={`UNKNOWN (${unknownItems.length}) — never moved`} tone="neutral">
        <ResourceTable rows={unknownItems} showReason />
      </ResourceSection>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : "text-stone-800";
  return (
    <div className="border border-stone-200 rounded-lg p-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Btn({ children, onClick, busy, disabled, tone }: { children: React.ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean; tone?: "danger" }) {
  const base = tone === "danger" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-stone-800 hover:bg-stone-900 text-white";
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`text-sm px-3 py-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed ${base}`}
    >
      {busy ? "..." : children}
    </button>
  );
}

function ResourceSection({ title, tone, children }: { title: string; tone?: "ok" | "warn" | "neutral"; children: React.ReactNode }) {
  const border = tone === "ok" ? "border-emerald-200" : tone === "warn" ? "border-amber-200" : "border-stone-200";
  return (
    <div className={`border ${border} rounded-lg p-3`}>
      <div className="text-sm font-medium text-stone-700 mb-2">{title}</div>
      {children}
    </div>
  );
}

function ResourceTable({ rows, showReason }: { rows: StorageResourceRow[]; showReason?: boolean }) {
  if (rows.length === 0) return <div className="text-xs text-stone-400">ไม่มีรายการ</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-stone-400">
            <th className="py-1 pr-3">Path</th>
            <th className="py-1 pr-3">ขนาด</th>
            <th className="py-1 pr-3">ประเภท</th>
            <th className="py-1 pr-3">Confidence</th>
            {showReason && <th className="py-1 pr-3">เหตุผล</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.path} className="border-t border-stone-100">
              <td className="py-1 pr-3 font-mono">{r.path}</td>
              <td className="py-1 pr-3 tabular-nums">{human(r.size_bytes)}</td>
              <td className="py-1 pr-3">{r.classification.classification}</td>
              <td className="py-1 pr-3 tabular-nums">{r.classification.confidence.toFixed(2)}</td>
              {showReason && <td className="py-1 pr-3 text-stone-500">{r.classification.blocked_reason ?? "-"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

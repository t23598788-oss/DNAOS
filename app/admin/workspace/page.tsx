"use client";

import { useState, useCallback, useEffect } from "react";

async function call(command: string, params: Record<string, unknown> = {}) {
  const res = await fetch("/api/admin/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, ...params }),
  });
  return res.json();
}

export default function WorkspacePage() {
  const [locks, setLocks] = useState<any[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [lookupPath, setLookupPath] = useState("");
  const [impact, setImpact] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [l, c] = await Promise.all([call("list_locks"), call("list_conflicts")]);
    if (l.ok) setLocks(l.locks);
    if (c.ok) setConflicts(c.conflicts);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runAnalyze = useCallback(async () => {
    if (!lookupPath) return;
    setBusy("analyzing");
    setError(null);
    const r = await call("analyze_impact", { resourcePath: lookupPath });
    if (!r.ok) { setError(r.error?.reason ?? "analyze failed"); setBusy(null); return; }
    setImpact(r.impact);
    setBusy(null);
  }, [lookupPath]);

  const runCreatePlan = useCallback(async () => {
    if (!lookupPath) return;
    setBusy("planning");
    setError(null);
    const r = await call("create_migration_plan", { resourcePath: lookupPath, resourceType: "file" });
    if (!r.ok) { setError(r.error?.reason ?? "plan failed"); setBusy(null); return; }
    setPlan(r.plan);
    setBusy(null);
  }, [lookupPath]);

  const runApprove = useCallback(async () => {
    if (!plan) return;
    setBusy("approving");
    const r = await call("approve_migration_plan", { planId: plan.id });
    if (!r.ok) setError(r.reason ?? "approve failed");
    setBusy(null);
  }, [plan]);

  const runExecute = useCallback(async () => {
    if (!plan) return;
    if (!confirm(`ย้าย ${lookupPath} ไปยัง macOS Trash จริง — ยืนยันหรือไม่?`)) return;
    setBusy("executing");
    const r = await call("execute_migration", { planId: plan.id });
    if (!r.ok) setError(r.reason ?? "execute failed");
    else alert(`ย้ายไป Trash แล้ว: ${r.trashPath}`);
    setBusy(null);
  }, [plan, lookupPath]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-800">Workspace</h1>
        <p className="text-sm text-stone-500 mt-1">
          Lock Manager / Dependency Registry / Migration Queue / Conflict History — Constitution Rule 116
        </p>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <Section title={`Workspace Lock (${locks.length} active)`}>
        {locks.length === 0 ? <Empty /> : (
          <Table
            cols={["resource_type", "resource_path", "holder_actor", "holder_session_id", "expires_at"]}
            rows={locks}
          />
        )}
      </Section>

      <Section title="Dependency Graph — lookup a resource">
        <div className="flex gap-2 mb-2">
          <input
            className="flex-1 text-sm border border-stone-300 rounded px-2 py-1"
            placeholder="e.g. engines/documents/engine.ts"
            value={lookupPath}
            onChange={(e) => setLookupPath(e.target.value)}
          />
          <button onClick={runAnalyze} disabled={busy === "analyzing"} className="text-sm px-3 py-1.5 rounded-md bg-stone-800 text-white disabled:opacity-40">
            {busy === "analyzing" ? "..." : "Analyze Impact"}
          </button>
        </div>
        {impact && (
          <div className="text-sm space-y-2">
            <div className={impact.safe_to_migrate ? "text-emerald-700" : "text-amber-700"}>
              {impact.safe_to_migrate ? "ไม่มี dependent — safe_to_migrate = true" : `พบ ${impact.dependency_count} dependent จริง — safe_to_migrate = false`}
            </div>
            {impact.dependents.length > 0 && (
              <Table cols={["source", "kind", "source_generated"]} rows={impact.dependents} />
            )}
          </div>
        )}
      </Section>

      <Section title="Migration Queue">
        <div className="flex gap-2 mb-2">
          <button onClick={runCreatePlan} disabled={!lookupPath || busy === "planning"} className="text-sm px-3 py-1.5 rounded-md bg-stone-800 text-white disabled:opacity-40">
            Create Migration Plan
          </button>
          <button onClick={runApprove} disabled={!plan || plan.approved || !plan.safe || busy === "approving"} className="text-sm px-3 py-1.5 rounded-md bg-stone-800 text-white disabled:opacity-40">
            Approve
          </button>
          <button onClick={runExecute} disabled={!plan || !plan.approved || busy === "executing"} className="text-sm px-3 py-1.5 rounded-md bg-red-600 text-white disabled:opacity-40">
            Move To Trash
          </button>
        </div>
        {plan && (
          <pre className="text-xs bg-stone-50 border border-stone-200 rounded p-3 overflow-x-auto">{JSON.stringify(plan, null, 2)}</pre>
        )}
      </Section>

      <Section title={`Conflict History (${conflicts.length})`}>
        {conflicts.length === 0 ? <Empty /> : (
          <Table cols={["resource_path", "requested_by_actor", "held_by_actor", "resolution", "attempted_at"]} rows={conflicts} />
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-stone-200 rounded-lg p-3">
      <div className="text-sm font-medium text-stone-700 mb-2">{title}</div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-stone-400">ไม่มีรายการ</div>;
}

function Table({ cols, rows }: { cols: string[]; rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-stone-400">
            {cols.map((c) => <th key={c} className="py-1 pr-3">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-stone-100">
              {cols.map((c) => <td key={c} className="py-1 pr-3 font-mono">{String(r[c] ?? "-")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

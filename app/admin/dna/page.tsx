"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types (mirrors lib/runtime/self-awareness.ts) ──────────────────

interface DigitalDNA {
  identity: string;
  age_days: number;
  constitution_rules: number;
  business_rules_enforced: number;
  workflows: number;
  commands: number;
  modules: number;
  capabilities_total: number;
  capabilities_active: number;
  capabilities_missing: number;
  decision_points_total: number;
  decision_points_codified: number;
  human_dependency_points: number;
  autonomous_pct: number;
  knowledge_pct: number;
  risk_level: string;
  next_evolution: string;
  confidence_pct: number;
}

interface CapabilityGap {
  capability: string;
  reason: string;
  needed_for: string[];
  to_add: string[];
  impact: string;
}

interface WorkflowGap {
  workflow: string;
  blocked_at: string;
  reason: string;
  missing_capability: string;
}

interface ContainerFit {
  container: string;
  fit_pct: number;
  reasons_for: string[];
  reasons_against: string[];
}

interface EvolutionPath {
  action: string;
  effort: string;
  before: Record<string, number>;
  after: Record<string, number>;
  unlocks: string[];
}

interface SelfDescription {
  generated_at: string;
  digital_dna: DigitalDNA;
  capability_gaps: CapabilityGap[];
  workflow_gaps: WorkflowGap[];
  container_fit: ContainerFit[];
  evolution: EvolutionPath[];
  missing_knowledge: { domain: string; item: string; impact: string }[];
  human_dependency: Record<string, { count: number; description?: string }>;
}

// ── Stat Card ──────────────────────────────────────────────────────

function Stat({ label, value, color = "text-stone-700", sub }: {
  label: string; value: string | number; color?: string; sub?: string;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-stone-400 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Progress Bar ───────────────────────────────────────────────────

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────

export default function DnaPage() {
  const [data, setData] = useState<SelfDescription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/self-description");
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e: any) {
      setError("โหลดข้อมูลไม่ได้: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-stone-800">Digital DNA</h1>
          <p className="text-[11px] text-stone-400">
            ระบบอธิบายตัวเองจาก Registry — ไม่ใช้ AI
          </p>
        </div>
        <button onClick={load} className="text-[11px] text-violet-600 hover:text-violet-800">
          ↺ Refresh
        </button>
      </div>

      <div className="p-6 space-y-6">
        {loading && (
          <div className="text-center py-8 text-stone-400 text-sm">กำลังอ่าน Registry…</div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* timestamp */}
            <p className="text-[11px] text-stone-400">
              สร้างเมื่อ: {new Date(data.generated_at).toLocaleString("th-TH")}
            </p>

            {/* ── Digital DNA metrics ── */}
            <section>
              <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                Digital DNA — {data.digital_dna.identity}
              </h2>
              <div className="grid grid-cols-4 gap-3 mb-3">
                <Stat label="อายุระบบ" value={`${data.digital_dna.age_days} วัน`} />
                <Stat label="Modules" value={data.digital_dna.modules} />
                <Stat label="Commands" value={data.digital_dna.commands} />
                <Stat label="Workflows" value={data.digital_dna.workflows} />
              </div>
              <div className="grid grid-cols-4 gap-3 mb-3">
                <Stat
                  label="อัตโนมัติ"
                  value={`${data.digital_dna.autonomous_pct}%`}
                  color={data.digital_dna.autonomous_pct >= 70 ? "text-green-600" : "text-amber-600"}
                />
                <Stat
                  label="ความรู้ระบบ"
                  value={`${data.digital_dna.knowledge_pct}%`}
                  color="text-sky-600"
                />
                <Stat
                  label="ความมั่นใจ"
                  value={`${data.digital_dna.confidence_pct}%`}
                  color="text-violet-600"
                />
                <Stat
                  label="Risk Level"
                  value={data.digital_dna.risk_level}
                  color={data.digital_dna.risk_level === "Low" ? "text-green-600" : "text-amber-600"}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-500">Decision Points</span>
                    <span className="font-mono text-stone-700">
                      {data.digital_dna.decision_points_codified}/{data.digital_dna.decision_points_total}
                    </span>
                  </div>
                  <Bar
                    pct={data.digital_dna.decision_points_total > 0
                      ? (data.digital_dna.decision_points_codified / data.digital_dna.decision_points_total) * 100
                      : 0}
                    color="bg-violet-400"
                  />
                </div>
                <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-500">Capabilities</span>
                    <span className="font-mono text-stone-700">
                      {data.digital_dna.capabilities_active}/{data.digital_dna.capabilities_total}
                    </span>
                  </div>
                  <Bar
                    pct={data.digital_dna.capabilities_total > 0
                      ? (data.digital_dna.capabilities_active / data.digital_dna.capabilities_total) * 100
                      : 0}
                    color="bg-green-400"
                  />
                </div>
                <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-stone-500">Human Dependency</span>
                    <span className="font-mono text-stone-700">
                      {data.digital_dna.human_dependency_points} points
                    </span>
                  </div>
                  <Bar
                    pct={Math.min(100, data.digital_dna.human_dependency_points * 5)}
                    color="bg-amber-400"
                  />
                </div>
              </div>
              <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 text-xs">
                <span className="text-violet-500 font-semibold">Next Evolution: </span>
                <span className="text-violet-700">{data.digital_dna.next_evolution}</span>
              </div>
            </section>

            {/* ── Workflow Gaps ── */}
            {data.workflow_gaps.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                  Workflow ที่ยังติดขัด ({data.workflow_gaps.length})
                </h2>
                <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
                  {data.workflow_gaps.map((w, i) => (
                    <div key={i} className="px-4 py-3 flex items-start gap-4">
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-stone-700">{w.workflow}</div>
                        <div className="text-[11px] text-stone-400 mt-0.5">
                          ติดที่: <span className="text-amber-600">{w.blocked_at}</span>
                        </div>
                        <div className="text-[11px] text-red-600 mt-0.5">{w.reason}</div>
                      </div>
                      <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-mono shrink-0">
                        {w.missing_capability}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Capability Gaps ── */}
            {data.capability_gaps.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                  Capability Gaps ({data.capability_gaps.length})
                </h2>
                <div className="space-y-2">
                  {data.capability_gaps.map((g, i) => (
                    <div key={i} className="bg-white border border-stone-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-stone-700">{g.capability}</div>
                          <div className="text-[11px] text-stone-500 mt-0.5">{g.reason}</div>
                          {g.impact && (
                            <div className="text-[11px] text-amber-600 mt-1">ผลกระทบ: {g.impact}</div>
                          )}
                        </div>
                      </div>
                      {g.needed_for.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {g.needed_for.map((n) => (
                            <span key={n} className="text-[10px] bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">
                              {n}
                            </span>
                          ))}
                        </div>
                      )}
                      {g.to_add.length > 0 && (
                        <div className="mt-2">
                          <span className="text-[10px] text-stone-400">ต้องเพิ่ม: </span>
                          <span className="text-[10px] text-violet-600">{g.to_add.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Container Fit ── */}
            {data.container_fit.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                  Container Fit
                </h2>
                <div className="grid grid-cols-3 gap-3">
                  {data.container_fit.map((c) => (
                    <div key={c.container} className="bg-white border border-stone-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-stone-700">{c.container}</span>
                        <span className={`text-sm font-bold ${c.fit_pct >= 70 ? "text-green-600" : c.fit_pct >= 40 ? "text-amber-600" : "text-red-600"}`}>
                          {c.fit_pct}%
                        </span>
                      </div>
                      <Bar
                        pct={c.fit_pct}
                        color={c.fit_pct >= 70 ? "bg-green-400" : c.fit_pct >= 40 ? "bg-amber-400" : "bg-red-400"}
                      />
                      {c.reasons_against.length > 0 && (
                        <div className="mt-2 text-[10px] text-red-500 space-y-0.5">
                          {c.reasons_against.slice(0, 3).map((r) => (
                            <div key={r}>✗ {r}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Evolution Paths ── */}
            {data.evolution.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                  Evolution Paths ({data.evolution.length})
                </h2>
                <div className="space-y-2">
                  {data.evolution.map((e, i) => (
                    <div key={i} className="bg-white border border-stone-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="text-xs font-semibold text-stone-700">{e.action}</div>
                        <span className="text-[10px] text-stone-400 shrink-0 bg-stone-100 px-2 py-0.5 rounded">
                          {e.effort}
                        </span>
                      </div>
                      {e.unlocks.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {e.unlocks.map((u) => (
                            <span key={u} className="text-[10px] bg-violet-50 text-violet-600 border border-violet-200 px-1.5 py-0.5 rounded">
                              → {u}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                        {Object.entries(e.before).slice(0, 3).map(([k, v]) => (
                          <div key={k} className="flex justify-between">
                            <span className="text-stone-400">{k}</span>
                            <span>
                              <span className="text-stone-500">{v}</span>
                              {e.after[k] != null && (
                                <span className="text-green-600 ml-1">→ {e.after[k]}</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Missing Knowledge ── */}
            {data.missing_knowledge.length > 0 && (
              <section>
                <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">
                  Missing Knowledge ({data.missing_knowledge.length})
                </h2>
                <div className="bg-white border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100">
                  {data.missing_knowledge.map((m, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                      <span className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded shrink-0">
                        {m.domain}
                      </span>
                      <div className="flex-1">
                        <div className="text-[11px] text-stone-700">{m.item}</div>
                        {m.impact && (
                          <div className="text-[10px] text-amber-600 mt-0.5">{m.impact}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

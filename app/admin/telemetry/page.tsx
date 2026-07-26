"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { createBrowserSupabase } from "@/services/supabase/browser";
import type { BeamEvent, DeviceMarker, NodeId, TelemetryNode } from "./GlobeView";

const GlobeView = dynamic(() => import("./GlobeView"), { ssr: false });

// Real-Time 3D Telemetry (owner, 2026-07-26, "FINAL COMMAND" →
// "FINAL ARCHITECTURE: 3D HOLOGRAM NETWORK TOPOLOGY"). This page IS the
// landing view — no click to open, no menu on top of it. Real command
// beams fire from real ai_tasks row changes (Supabase Realtime), real
// latency from /api/admin/telemetry/ping, real fault data from the existing
// /api/governance (architecture-book.json — no separate fake health system
// built, reused per Rule 101/103), real device markers from
// /api/admin/telemetry/devices (customer_sites.gps_lat/lng, real LINE
// location shares — not fabricated positions).

const BASE_NODES: Omit<TelemetryNode, "status">[] = [
  { id: "local_edge",    kind: "robot",     label: "Local AI Engine — Mac/Ollama (ขอนแก่น)", lat: 16.4322, lng: 102.8236 },
  { id: "cloud_core",    kind: "cloud",     label: "Cloud Core — Supabase (Seoul)", lat: 37.5665, lng: 126.9780 },
  { id: "external_line", kind: "satellite", label: "External Services — LINE Platform (Tokyo)", lat: 35.6762, lng: 139.6503 },
];

interface ArchNode {
  id: string; type: string; layer: string; name_en: string;
  purpose_th: string; status: "OK" | "BROKEN" | "UNUSED" | "UNREGISTERED"; error_th?: string;
}

export default function TelemetryPage() {
  const [nodes, setNodes] = useState<TelemetryNode[]>(BASE_NODES.map((n) => ({ ...n, status: "OK" })));
  const [devices, setDevices] = useState<DeviceMarker[]>([]);
  const [beamQueue, setBeamQueue] = useState<BeamEvent[]>([]);
  const [latency, setLatency] = useState<{ cloud_core: number | null; external_line: number | null }>({ cloud_core: null, external_line: null });
  const [brokenNodes, setBrokenNodes] = useState<ArchNode[]>([]);
  const [summary, setSummary] = useState<{ total: number; ok: number; broken: number; unused: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pendingTaskIds = useRef<Set<string>>(new Set());

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Real fault data — reuse the existing architecture-book.json governance
  // feed instead of building a parallel health system.
  useEffect(() => {
    let cancelled = false;
    async function loadGovernance() {
      try {
        const res = await fetch("/api/governance");
        const data = await res.json();
        if (cancelled || !data?.nodes) return;
        const broken = (data.nodes as ArchNode[]).filter((n) => n.status === "BROKEN");
        setBrokenNodes(broken);
        setSummary(data.summary ?? null);
        // Cloud Core reflects real architecture-wide breakage (any BROKEN
        // module anywhere is a real cloud-side code fault today, since all
        // registered modules run in this same Supabase/Vercel deployment).
        setNodes((prev) => prev.map((n) =>
          n.id === "cloud_core" ? { ...n, status: broken.length > 0 ? "BROKEN" : "OK" } : n
        ));
      } catch { /* keep last-known state, never fabricate a status */ }
    }
    loadGovernance();
    const iv = setInterval(loadGovernance, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Real device markers — customer_sites.gps_lat/lng, actual LINE location
  // shares already stored, refreshed periodically (new sites appear live).
  useEffect(() => {
    let cancelled = false;
    async function loadDevices() {
      try {
        const res = await fetch("/api/admin/telemetry/devices");
        const data = await res.json();
        if (cancelled) return;
        setDevices((data.devices ?? []).map((d: any) => ({ id: d.id, lat: d.gps_lat, lng: d.gps_lng })));
      } catch { /* keep last-known devices */ }
    }
    loadDevices();
    const iv = setInterval(loadDevices, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Real latency ping — scales beam travel-time to what actually happened.
  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        const res = await fetch("/api/admin/telemetry/ping");
        const data = await res.json();
        if (cancelled) return;
        const cloud = data.results?.find((r: any) => r.node === "cloud_core");
        const line = data.results?.find((r: any) => r.node === "external_line");
        setLatency({ cloud_core: cloud?.ms ?? null, external_line: line?.ms ?? null });
        setNodes((prev) => prev.map((n) => {
          if (n.id === "external_line") return { ...n, status: line?.ok === false ? "BROKEN" : n.status };
          return n;
        }));
      } catch { /* keep last-known latency */ }
    }
    ping();
    const iv = setInterval(ping, 15_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Real command beams — subscribe to real ai_tasks row changes.
  // insert (status=pending) = command sent Local Edge → Cloud Core.
  // update to status=done   = ACK reflection Cloud Core → Local Edge.
  useEffect(() => {
    const supabase = createBrowserSupabase();
    const durationFor = (ms: number | null) => Math.min(4000, Math.max(500, (ms ?? 200) * 12));

    const channel = supabase
      .channel("telemetry-ai-tasks")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_tasks" }, (payload) => {
        pendingTaskIds.current.add(payload.new.id);
        setBeamQueue((q) => [...q, {
          from: "local_edge", to: "cloud_core",
          durationMs: durationFor(latency.cloud_core), color: "#38bdf8",
        }]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ai_tasks" }, (payload) => {
        if (payload.new.status !== "done" && payload.new.status !== "failed") return;
        if (!pendingTaskIds.current.has(payload.new.id)) return;
        pendingTaskIds.current.delete(payload.new.id);
        setBeamQueue((q) => [...q, {
          from: "cloud_core", to: "local_edge",
          durationMs: durationFor(latency.external_line),
          color: payload.new.status === "failed" ? "#ef4444" : "#22c55e",
        }]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latency]);

  const consumeBeams = useCallback(() => setBeamQueue([]), []);

  return (
    <div className="fixed inset-0 bg-[#050510] overflow-hidden select-none" onClick={!isFullscreen ? enterFullscreen : undefined}>
      <GlobeView nodes={nodes} devices={devices} beamQueue={beamQueue} onBeamConsumed={consumeBeams} />

      {!isFullscreen && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 text-slate-300 text-xs px-4 py-2 rounded-lg font-mono">
            คลิกที่ไหนก็ได้เพื่อเข้าเต็มจอ
          </div>
        </div>
      )}

      {/* Collapsed edge strip → reveals nav menu on hover, per spec: nothing
          may cover the live view except a thin strip the admin deliberately
          nudges. */}
      <div
        className="absolute top-0 right-0 h-full w-3 hover:w-64 transition-all duration-200 z-20 group"
        onMouseEnter={() => setMenuOpen(true)}
        onMouseLeave={() => setMenuOpen(false)}
      >
        <div className={`h-full bg-[#0a0a1a]/95 border-l border-[#1e2535] p-4 overflow-y-auto transition-opacity ${menuOpen ? "opacity-100" : "opacity-0"}`}>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">เมนู</p>
          <a href="/admin/dashboard" className="block text-xs text-slate-300 hover:text-violet-400 py-1.5">← Dashboard</a>
          <a href="/admin/graph" className="block text-xs text-slate-300 hover:text-violet-400 py-1.5">Architecture Graph (2D/3D เดิม)</a>
          <div className="border-t border-[#1e2535] my-3" />
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Latency จริง</p>
          <p className="text-[11px] text-slate-400 font-mono">Cloud Core: {latency.cloud_core ?? "—"} ms</p>
          <p className="text-[11px] text-slate-400 font-mono">LINE: {latency.external_line ?? "—"} ms</p>
        </div>
      </div>

      {/* Fault report panel — always visible per spec ("ไม่ต้องมีเมนูมาบัง...
          พังจริงบอกพังจริง"), not gated behind a click. */}
      <div className="absolute top-0 left-0 h-full w-80 max-w-[85vw] pointer-events-none z-10 flex flex-col p-4">
        <div className="pointer-events-auto bg-[#0a0a1a]/90 border border-[#1e2535] rounded-xl p-4 space-y-3 overflow-y-auto max-h-full">
          <div>
            <h1 className="text-sm font-bold text-slate-200">DNA OS — Real-Time Telemetry</h1>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {summary ? `${summary.total} modules · ${summary.ok} OK · ${summary.broken} พัง` : "กำลังโหลด…"}
            </p>
          </div>

          <div className="space-y-1.5">
            {nodes.map((n) => (
              <div key={n.id} className="flex items-center gap-2 text-[11px]">
                <span className={`w-2 h-2 rounded-full shrink-0 ${n.status === "BROKEN" ? "bg-red-500 animate-pulse" : "bg-green-500"}`} />
                <span className={n.status === "BROKEN" ? "text-red-400" : "text-slate-300"}>{n.label}</span>
              </div>
            ))}
          </div>

          {brokenNodes.length > 0 && (
            <div className="border-t border-red-900/40 pt-3">
              <p className="text-[10px] text-red-400 uppercase tracking-wider font-bold mb-2">
                ⚠ พังจริง ({brokenNodes.length})
              </p>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {brokenNodes.map((n) => (
                  <div key={n.id} className="bg-red-950/40 border border-red-900/50 rounded-lg p-2">
                    <p className="text-[11px] font-mono text-red-300 break-all">{n.name_en.split("/").slice(-1)[0]}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{n.layer}</p>
                    {n.error_th && <p className="text-[10px] text-red-400 mt-1">{n.error_th}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {brokenNodes.length === 0 && summary && (
            <p className="text-[11px] text-green-400">✓ ไม่พบความเสียหายในระบบตอนนี้</p>
          )}
        </div>
      </div>
    </div>
  );
}

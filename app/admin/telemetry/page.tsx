"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createBrowserSupabase } from "@/services/supabase/browser";
import { GraphPage } from "../graph/page";

// Real-Time Signal Pulse on the Real Architecture Graph (owner, 2026-07-26 —
// "REVERT AND RESTORE: USE ORIGINAL ARCHITECTURE GRAPH"). The earlier globe
// visualization was explicitly rejected — this reuses the real, existing
// 3D Force Architecture Graph (539 nodes, real import edges, click-for-
// details sidebar, layer filters, OK/BROKEN/UNUSED status) unchanged, and
// only adds a live overlay: when a real ai_tasks row is inserted/updated,
// the real module(s) that actually handle that kind of work light up, and
// the real import edge between them (already in the graph, never invented)
// gets a traveling particle pulse via ForceGraph3DView's native
// linkDirectionalParticles.
//
// Mapping below is real, not guessed — read directly from
// supabase/functions/ai-callback/index.ts's own kind-dispatch (2026-07-26):
//   classify_image  -> ai-callback/index.ts -> engines/process-classified-image.ts
//   resolve_material -> ai-callback/index.ts -> engines/event-followup.ts
//   handle_text     -> ai-callback/index.ts -> engines/build-event-from-extraction.ts
const AI_CALLBACK_ID = "module:supabase/functions/ai-callback/index.ts";
const KIND_TARGET: Record<string, string> = {
  classify_image: "module:supabase/functions/line-webhook-v2/engines/process-classified-image.ts",
  resolve_material: "module:supabase/functions/line-webhook-v2/engines/event-followup.ts",
  handle_text: "module:supabase/functions/line-webhook-v2/engines/build-event-from-extraction.ts",
};

const PULSE_HOLD_MS = 2500;

export default function TelemetryPage() {
  const [pulseNodeIds, setPulseNodeIds] = useState<Set<string>>(new Set());
  const [pulseLinkKeys, setPulseLinkKeys] = useState<Set<string>>(new Set());
  // Inside the Tauri desktop wrap, the window itself now opens already
  // maximized/fullscreen (src-tauri/tauri.conf.json) — the browser Fullscreen
  // API this "click anywhere" prompt was built for doesn't apply there, and
  // the Tauri webview never reliably fires `fullscreenchange`, so
  // `isFullscreen` could never flip to true and the tooltip stayed stuck on
  // screen forever (owner-reported, 2026-07-30). Detect Tauri the same way
  // app/login/page.tsx does and just skip the whole prompt in that context.
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [isFullscreen, setIsFullscreen] = useState(isTauri);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    if (isTauri) return;
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [isTauri]);

  const firePulse = useCallback((kind: string) => {
    const target = KIND_TARGET[kind];
    if (!target) return;
    const key = `${AI_CALLBACK_ID}->${target}`;

    setPulseNodeIds((prev) => new Set(prev).add(AI_CALLBACK_ID).add(target));
    setPulseLinkKeys((prev) => new Set(prev).add(key));

    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    timers.current.set(key, setTimeout(() => {
      setPulseNodeIds((prev) => { const n = new Set(prev); n.delete(AI_CALLBACK_ID); n.delete(target); return n; });
      setPulseLinkKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
      timers.current.delete(key);
    }, PULSE_HOLD_MS));
  }, []);

  // Real command signal — subscribe to real ai_tasks changes, not a fake loop.
  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel("telemetry-graph-pulse")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_tasks" }, (payload) => {
        firePulse(payload.new.kind);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "ai_tasks" }, (payload) => {
        if (payload.new.status === "done" || payload.new.status === "failed") firePulse(payload.new.kind);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [firePulse]);

  return (
    <div
      className="fixed inset-0 bg-stone-50 overflow-hidden"
      onClick={!isFullscreen ? enterFullscreen : undefined}
    >
      <GraphPage pulseNodeIds={pulseNodeIds} pulseLinkKeys={pulseLinkKeys} />
      {!isFullscreen && (
        <div className="absolute inset-x-0 top-16 flex justify-center pointer-events-none">
          <div className="bg-black/70 text-white text-xs px-4 py-2 rounded-lg font-mono">
            คลิกที่ไหนก็ได้เพื่อเข้าเต็มจอ
          </div>
        </div>
      )}
    </div>
  );
}

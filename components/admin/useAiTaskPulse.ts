"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createBrowserSupabase } from "@/services/supabase/browser";

// Real-Time Signal Pulse (owner, 2026-07-26 — "REVERT AND RESTORE: USE
// ORIGINAL ARCHITECTURE GRAPH"), extracted out of app/admin/telemetry/page.tsx
// (owner directive, unified Build/Graph/Telemetry screen, 2026-08-04) so the
// merged /admin/system page can reuse the exact same real ai_tasks Realtime
// subscription instead of a second copy of this logic.
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

export function useAiTaskPulse() {
  const [pulseNodeIds, setPulseNodeIds] = useState<Set<string>>(new Set());
  const [pulseLinkKeys, setPulseLinkKeys] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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

  return { pulseNodeIds, pulseLinkKeys };
}

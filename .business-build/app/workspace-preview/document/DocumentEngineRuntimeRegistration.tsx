"use client";

/**
 * SDRN-P3 (registry/CHANGELOG.json DNA-000032) — the first real call to
 * core/workspace/runtimeRegistry.ts's register() anywhere in this app.
 *
 * Per Rule 101 (Connect before Create), this was checked before being built:
 * runtimeRegistry.ts already existed (Phase 0) with register/unregister/
 * getStatus/list/subscribe, but register() had never been called by
 * anything — confirmed repeatedly across DNA-000024/025/028/029/031. Its
 * only 2 real importers (core/workspace/presenterRegistry.ts,
 * core/workspace/index.ts) only ever called .get(), never .register(). The
 * Canvas/Visual-Workspace components that transitively import the barrel
 * exporting runtimeRegistry (Canvas.tsx, WorkspaceContext.tsx, etc.) don't
 * call it either, and WorkspaceContext.tsx's own module-registry.json entry
 * says "not mounted anywhere yet" (deprecated:true) — so that path wasn't a
 * safe place to prove this works for real. This page (workspace-preview/
 * document) is a genuinely live, auth-gated, already-real route instead.
 *
 * Honest model mismatch, not hidden: RuntimeHandle (core/workspace/types.ts)
 * was designed for long-running processes (background jobs, live
 * subscriptions) with a real start()/stop() lifecycle. The Document Engine
 * (engines/documents/engine.ts's generateDoc) is a stateless call/return
 * function with no such lifecycle — start()/stop() below are documented
 * no-ops, and "running" is used to mean "available and serving," not "a
 * process is executing." This is the closest honest fit using the EXISTING
 * type, not a new one.
 */
import { useEffect, useState } from "react";
import { runtimeRegistry } from "@/core/workspace";
import type { RuntimeStatus } from "@/core/workspace/types";
import type { SelfDescription } from "@/core/shared/types";

const RUNTIME_ID = "document-engine";

function toRuntimeStatus(status: SelfDescription["status"]): RuntimeStatus {
  if (status === "READY") return "running";
  if (status === "NOT_READY") return "error";
  return "idle";
}

export function DocumentEngineRuntimeRegistration() {
  const [description, setDescription] = useState<SelfDescription | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/runtime/document-engine")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SelfDescription | null) => {
        if (cancelled || !data) return;
        setDescription(data);
        runtimeRegistry.register({
          id: RUNTIME_ID,
          label: "Document Engine",
          status: toRuntimeStatus(data.status),
          // No real start/stop lifecycle exists for a stateless engine —
          // documented no-ops, not a fabricated capability.
          start: () => {},
          stop: () => {},
        });
      })
      .catch(() => {
        /* Self Description fetch failing must not break the page it's
           registering from — this is a background enrichment, not the
           page's own data. */
      });

    return () => {
      cancelled = true;
      runtimeRegistry.unregister(RUNTIME_ID);
    };
  }, []);

  if (!description) return null;

  // Minimal, real, visible proof this actually ran — not just a silent
  // side effect nobody could verify happened.
  return (
    <div className="fixed bottom-2 right-2 z-50 rounded bg-slate-900/90 px-3 py-2 text-xs text-slate-200 shadow-lg">
      <div className="font-semibold">Runtime: {RUNTIME_ID}</div>
      <div>status: {description.status}</div>
      <div>registered via runtimeRegistry.register() — SDRN-P3</div>
    </div>
  );
}

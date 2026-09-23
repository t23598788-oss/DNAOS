"use client";

/**
 * Owner System Reality Report Section (owner, 2026-08-10, Capability
 * Roadmap #57 "OWNER SYSTEM REALITY REPORT", STEP 4+5, registry/
 * TASK_QUEUE.json TASK-053 follow-on, Constitution Rule 252).
 *
 * Renders the 5 Owner-facing sections this capability requires:
 *   1. SYSTEM STATUS   2. WORKING NOW   3. NOT WORKING / NOT CONNECTED
 *   4. CONNECTION GAPS   5. NEXT SYSTEM ACTION
 *
 * Every real fact rendered here comes from a real fetch to
 * /api/admin/system-reality (app/api/admin/system-reality/route.ts ->
 * _lib/ownerLanguage.ts -> the real, already-built, already-tested
 * (26/26) app/api/admin/ide/_lib/systemRealityRuntime.ts). No mock/fake/
 * demo data — a genuine load failure renders an honest error state, never
 * a fabricated fallback number.
 *
 * STEP 6 (real, done here): the Owner explicitly does not want to have to
 * click "refresh" manually. This section now real, silently re-fetches on
 * a fixed interval via components/workspace/systemRealityPolling.ts's
 * startSystemRealityPolling() — see that file's own header for the real,
 * evidence-based reasoning for choosing health polling over a Supabase
 * Realtime subscription (short version: none of this report's real data
 * sources are backed by a live Supabase table, so a Realtime channel here
 * would have nothing real to ever fire on). The very first load still
 * shows the "Checking real system status…" state; every poll after that
 * is silent (no loading flicker, no state reset) — a failed poll simply
 * keeps showing the last real, successfully-loaded report rather than
 * blanking the page, exactly like app/admin/dashboard/page.tsx's own
 * existing "ทำงานเงียบ ไม่กระพริบ" convention this reuses.
 *
 * STEP 5's hard rule: the top-level text on every card below is already
 * Owner-language (sanitized server-side by ownerLanguage.ts's
 * sanitizeOwnerText()) — this component never re-adds raw technical
 * fields (module paths, registry filenames, evidence citations) to the
 * default view. Each card's real technical detail is only ever rendered
 * behind an explicit "Technical detail" toggle click — reachable, never
 * default-visible.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";
import { elevation, typography, semanticColors, useTheme, fontWeight, type SemanticTone } from "@/presentation/foundation/tokens";
import type {
  OwnerSystemRealityReport,
  OwnerCapabilityCard,
  OwnerConnectionCard,
  OwnerNextAction,
} from "@/app/api/admin/system-reality/_lib/ownerLanguage";
import type { CapabilityStatus, ConnectionLinkState } from "@/app/api/admin/ide/_lib/systemRealityRuntime";
import { startSystemRealityPolling, SYSTEM_REALITY_POLL_INTERVAL_MS } from "./systemRealityPolling";

const CAPABILITY_STATUS_TONE: Record<CapabilityStatus, SemanticTone> = {
  LIVE: "success",
  DEGRADED: "warning",
  BLOCKED: "error",
  NOT_CONNECTED: "info",
  BUILT_NOT_WIRED: "info",
  WIRED_NOT_TESTED: "info",
  NOT_BUILT: "info",
  UNKNOWN: "info",
};

const CONNECTION_STATE_TONE: Record<ConnectionLinkState, SemanticTone> = {
  CONNECTED: "success",
  CONNECTED_NOT_TESTED: "info",
  NOT_CONNECTED: "warning",
  WAS_WORKING_NOW_BROKEN: "error",
};

const SYSTEM_STATUS_TONE: Record<"READY" | "DEGRADED" | "BLOCKED", SemanticTone> = {
  READY: "success",
  DEGRADED: "warning",
  BLOCKED: "error",
};

const SYSTEM_STATUS_ICON: Record<"READY" | "DEGRADED" | "BLOCKED", typeof CheckCircle2> = {
  READY: CheckCircle2,
  DEGRADED: AlertTriangle,
  BLOCKED: XCircle,
};

export function SystemRealityReportSection() {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];

  const [report, setReport] = useState<OwnerSystemRealityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  // Real ref, not state — lets fetchReport (a stable callback used by
  // both the mount effect and the poll interval) know whether this is
  // the very first real load without re-creating the callback on every
  // render (which would otherwise force the polling effect below to keep
  // tearing down/restarting its real setInterval).
  const hasLoadedOnceRef = useRef(false);

  const fetchReport = useCallback(async () => {
    const isFirstLoad = !hasLoadedOnceRef.current;
    try {
      const res = await fetch("/api/admin/system-reality");
      if (!res.ok) {
        // Silent on a poll (keep showing the last real, successfully-
        // loaded report) — only surface an error state if this is the
        // very first load and there is nothing real to show yet.
        if (isFirstLoad) setError(`Could not load the System Reality Report (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      setReport((data.report as OwnerSystemRealityReport) ?? null);
      setError(null);
      setLastCheckedAt(new Date());
    } catch {
      if (isFirstLoad) setError("Could not load the System Reality Report — the request failed.");
    } finally {
      hasLoadedOnceRef.current = true;
      if (isFirstLoad) setLoading(false);
    }
  }, []);

  // First real load.
  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  // STEP 6 — real, silent polling so the Owner never has to click
  // "refresh" (see this file's header for the real realtime-vs-polling
  // judgment call). startSystemRealityPolling() is a real, plain
  // setInterval wrapper (components/workspace/systemRealityPolling.ts),
  // exercised directly by a real timer-based test in
  // scripts/system-reality-gaploop-test.ts.
  useEffect(() => {
    return startSystemRealityPolling(fetchReport);
  }, [fetchReport]);

  if (loading) {
    return <div className={`text-center text-sm ${ty.description}`}>Checking real system status…</div>;
  }
  if (error || !report) {
    return (
      <div className={`p-6 rounded-lg text-center ${e.card}`}>
        <p className={`text-sm font-semibold ${semanticColors[theme].error.text}`}>{error ?? "No real report data returned."}</p>
      </div>
    );
  }

  const StatusIcon = SYSTEM_STATUS_ICON[report.system_status.value];
  const statusTone = SYSTEM_STATUS_TONE[report.system_status.value];

  return (
    <div className="space-y-14">
      {/* 1. SYSTEM STATUS */}
      <div className={`p-6 sm:p-8 rounded-lg text-center ${e.floatingSurface}`}>
        <div className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full border ${semanticColors[theme][statusTone].chip}`}>
          <StatusIcon className="w-3.5 h-3.5" />
          {report.system_status.value}
        </div>
        <p className={`mt-4 text-sm sm:text-base max-w-2xl mx-auto ${ty.body}`}>{report.system_status.owner_explanation}</p>
        <p className={`mt-3 text-xs ${ty.description}`}>
          {report.working_now.length} working now · {report.not_working.length} not fully working, out of {report.technical.capability_count} real capabilities checked
        </p>
      </div>

      {/* 2. WORKING NOW */}
      <SubSection eyebrow="Working Now" title="What the business can rely on today" tone="success">
        {report.working_now.length === 0 ? (
          <EmptyNote text="No real capability currently qualifies as fully working." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.working_now.map((c) => (
              <CapabilityCardView key={c.capability_name} card={c} />
            ))}
          </div>
        )}
      </SubSection>

      {/* 3. NOT WORKING / NOT CONNECTED */}
      <SubSection eyebrow="Not Working / Not Connected" title="What is stuck, partial, or not linked up yet" tone="warning">
        {report.not_working.length === 0 ? (
          <EmptyNote text="No real capability is currently reported as not working." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.not_working.map((c) => (
              <CapabilityCardView key={c.capability_name} card={c} />
            ))}
          </div>
        )}
      </SubSection>

      {/* 4. CONNECTION GAPS */}
      <SubSection eyebrow="Connection Gaps" title="Where one real part should reach another, and whether it does" tone="info">
        {report.connection_gaps.length === 0 ? (
          <EmptyNote text="No real connection gaps computed." />
        ) : (
          <div className="space-y-3">
            {report.connection_gaps.map((g, i) => (
              <ConnectionCardView key={`${g.from}->${g.to}-${i}`} card={g} />
            ))}
          </div>
        )}
      </SubSection>

      {/* 5. NEXT SYSTEM ACTION */}
      <SubSection eyebrow="Next System Action" title="What connecting next would unlock" tone="info">
        {report.next_actions.length === 0 ? (
          <EmptyNote text="No real next action is currently computed — every real capability's own next_required_connection is empty." />
        ) : (
          <div className="space-y-3">
            {report.next_actions.map((a) => (
              <NextActionView key={a.capability_name} action={a} />
            ))}
          </div>
        )}
      </SubSection>

      <p className={`text-center text-xs ${ty.description}`}>
        Last real check: {(lastCheckedAt ?? new Date(report.generated_at)).toLocaleString()} · this section checks itself again automatically every {Math.round(SYSTEM_REALITY_POLL_INTERVAL_MS / 60000)} minutes — no need to reload the page.
      </p>
    </div>
  );
}

function SubSection({ eyebrow, title, tone, children }: { eyebrow: string; title: string; tone: SemanticTone; children: React.ReactNode }) {
  const { theme } = useTheme();
  const ty = typography[theme];
  return (
    <div>
      <div className="text-center">
        <p className={`text-xs font-semibold uppercase tracking-widest ${semanticColors[theme][tone].text}`}>{eyebrow}</p>
        <h3 className={`mt-1 text-lg sm:text-xl ${ty.heading} ${fontWeight.heading}`}>{title}</h3>
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  const { theme } = useTheme();
  const ty = typography[theme];
  return <p className={`text-center text-sm ${ty.description}`}>{text}</p>;
}

function StatusChip({ label, tone }: { label: string; tone: SemanticTone }) {
  const { theme } = useTheme();
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${semanticColors[theme][tone].chip}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${semanticColors[theme][tone].dot}`} />
      {label}
    </span>
  );
}

function TechnicalDetailToggle({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide ${ty.description} hover:underline`}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Technical detail
      </button>
      {open && <div className={`mt-2 p-3 rounded-md text-xs font-mono whitespace-pre-wrap break-words ${e.section} ${ty.description}`}>{children}</div>}
    </div>
  );
}

function CapabilityCardView({ card }: { card: OwnerCapabilityCard }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  const tone = CAPABILITY_STATUS_TONE[card.status];
  const d = card.drilldown;
  return (
    <div className={`p-5 rounded-lg ${e.card}`}>
      <div className="flex items-start justify-between gap-2">
        <h4 className={`text-sm font-semibold ${ty.heading}`}>{card.capability_name}</h4>
        <StatusChip label={card.owner_status_label} tone={tone} />
      </div>
      <p className={`mt-2 text-xs leading-relaxed ${ty.body}`}>{card.owner_summary}</p>
      <p className={`mt-2 text-xs leading-relaxed ${ty.description}`}>{card.owner_detail}</p>
      <TechnicalDetailToggle>
        <div>runtime_status: {d.runtime_status}</div>
        {d.current_blocker && <div className="mt-1.5">current_blocker: {d.current_blocker}</div>}
        {d.missing_connection && <div className="mt-1.5">missing_connection: {d.missing_connection}</div>}
        {d.connected_from.length > 0 && <div className="mt-1.5">connected_from: {d.connected_from.join(" | ")}</div>}
        {d.connected_to.length > 0 && <div className="mt-1.5">connected_to: {d.connected_to.join(" | ")}</div>}
        {d.next_required_connection && <div className="mt-1.5">next_required_connection: {d.next_required_connection}</div>}
        <div className="mt-1.5">last_verified: {d.last_verified}</div>
        {d.evidence.length > 0 && (
          <div className="mt-1.5">
            evidence:
            <ul className="list-disc list-inside">
              {d.evidence.map((ev, i) => (
                <li key={i}>{ev}</li>
              ))}
            </ul>
          </div>
        )}
      </TechnicalDetailToggle>
    </div>
  );
}

function ConnectionCardView({ card }: { card: OwnerConnectionCard }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  const tone = CONNECTION_STATE_TONE[card.state];
  const d = card.drilldown;
  return (
    <div className={`p-5 rounded-lg ${e.card}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-sm font-semibold ${ty.heading}`}>{card.from}</span>
        <ArrowRight className={`w-4 h-4 ${ty.description}`} />
        <StatusChip label={card.owner_state_label} tone={tone} />
        <ArrowRight className={`w-4 h-4 ${ty.description}`} />
        <span className={`text-sm font-semibold ${ty.heading}`}>{card.to}</span>
      </div>
      <p className={`mt-2 text-xs leading-relaxed ${ty.description}`}>{card.business_meaning}</p>
      <TechnicalDetailToggle>
        {d.from_module && <div>from_module: {d.from_module}</div>}
        {d.from_runtime && <div className="mt-1.5">from_runtime: {d.from_runtime}</div>}
        {d.to_module && <div className="mt-1.5">to_module: {d.to_module}</div>}
        {d.to_runtime && <div className="mt-1.5">to_runtime: {d.to_runtime}</div>}
        <div className="mt-1.5">technical_detail: {d.technical_detail}</div>
        {d.evidence.length > 0 && (
          <div className="mt-1.5">
            evidence:
            <ul className="list-disc list-inside">
              {d.evidence.map((ev, i) => (
                <li key={i}>{ev}</li>
              ))}
            </ul>
          </div>
        )}
      </TechnicalDetailToggle>
    </div>
  );
}

function NextActionView({ action }: { action: OwnerNextAction }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  return (
    <div className={`p-4 rounded-lg ${e.card}`}>
      <h4 className={`text-sm font-semibold ${ty.heading}`}>{action.capability_name}</h4>
      <p className={`mt-1.5 text-xs leading-relaxed ${ty.body}`}>{action.owner_action}</p>
      <TechnicalDetailToggle>
        <div>raw next_required_connection: {action.drilldown.raw_next_required_connection}</div>
      </TechnicalDetailToggle>
    </div>
  );
}

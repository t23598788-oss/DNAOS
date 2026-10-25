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
import type {
  RuleComplianceBlock,
  TestResultsBlock,
  CapabilityReadinessEntry,
  OpenDefectEntry,
} from "@/app/api/admin/ide/_lib/systemRealityRuntime";
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

      {/* STEP 07 (owner, 2026-10-18, ARCHITECTURE RUNTIME INTEGRATION) —
          4 หมวดเพิ่มเติม (02/04/05/07) ด้วยข้อมูล LIVE จริงจาก /api/admin/system-reality
          → audit blocks (passthrough เดิม) · ทุกหมวดแสดง 3 ชั้น: (ก) โจทย์/กฎ
          (ข) Source/Test/Runtime evidence (toggle) (ค) สถานะ PASS/FAIL/REVIEW ·
          ไม่มีข้อมูล mock — บล็อกไหน runtime ให้ไม่ได้จะเป็น NOT_VERIFIED/ว่างจริงใจ */}
      <ArchRuleComplianceView data={report.audit?.rule_compliance ?? null} />
      <ArchTestResultsView data={report.audit?.test_results ?? null} />
      <ArchCapabilityReadinessView rows={report.audit?.capability_readiness ?? null} />
      <ArchOpenDefectsView rows={report.audit?.open_defects ?? null} />

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

// ============================================================
// STEP 07 — 4 หมวดเพิ่มเติม (02 RULE COMPLIANCE · 04 CAPABILITY READINESS ·
// 05 TEST RESULTS · 07 OPEN DEFECTS) — ข้อมูล LIVE จริงจาก /api/admin/system-reality
// → audit passthrough · ทุกหมวด: (ก) โจทย์/กฎใน heading · (ข) evidence ซ้า
// หลัง TechnicalDetailToggle · (ค) chip PASS/FAIL/REVIEW/NOT_VERIFIED ·
// ห้าม mock — ข้อมูลไม่มีจริง = ว่าง/NOT_VERIFIED จริงใจ
// ============================================================

function ArchHeader({ num, title, dataMode, widget }: { num: string; title: string; dataMode: "LIVE" | "STATIC" | "NOT_VERIFIED"; widget?: { label: string; tone: SemanticTone } }) {
  const modeTone: SemanticTone = dataMode === "LIVE" ? "success" : dataMode === "STATIC" ? "info" : "warning";
  return (
    <SubSection eyebrow={`${num} · ${title}`} title={`${title} (audit — realtime registry authority)`} tone="info">
      <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
        <StatusChip label={dataMode} tone={modeTone} />
        {widget && <StatusChip label={widget.label} tone={widget.tone} />}
      </div>
    </SubSection>
  );
}

// หมวด 02 — RULE COMPLIANCE: BASELINE/CURRENT/DELTA จาก governance authority เดิม
// ห้าม hardcode — CURRENT มาจาก API จริง, BASELINE แสดงเป็นอ้างอิงย้อนหลังเท่านั้น
function ArchRuleComplianceView({ data }: { data: RuleComplianceBlock | null }) {
  const { theme } = useTheme();
  if (!data) {
    return <ArchEmpty text="RULE COMPLIANCE — NOT_VERIFIED: governance runtime did not return any live block." />;
  }
  const hasFail = data.rows.some((r) => r.current !== null && r.delta !== null && r.delta !== 0 && r.metric !== "ENFORCED_RULES" && (r.delta ?? 0) > 0) || (data.rule_conflicts ?? 0) > 0;
  const widget: { label: string; tone: SemanticTone } | undefined = !data.authority_ok
    ? { label: data.status, tone: "warning" }
    : hasFail ? { label: "REVIEW", tone: "warning" } : { label: "PASS" as const, tone: "success" as const };
  return (
    <SubSection eyebrow="02 · RULE COMPLIANCE" title="Rule compliance — what the real constitution currently counts" tone={hasFail ? "warning" : "success"}>
      <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
        <StatusChip label={data.authority_ok ? "LIVE" : "NOT_VERIFIED"} tone={data.authority_ok ? "success" : "warning"} />
        {widget && <StatusChip label={widget.label} tone={widget.tone} />}
      </div>
      <div className={`p-5 rounded-lg ${elevation[theme].card}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="pr-3 py-1.5">Metric</th>
              <th className="pr-3 py-1.5 text-right">BASELINE</th>
              <th className="pr-3 py-1.5 text-right">CURRENT</th>
              <th className="pr-3 py-1.5 text-right">DELTA</th>
              <th className="py-1.5 text-right">TARGET</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.metric} className="border-t">
                <td className="pr-3 py-1.5 font-mono text-xs">{r.metric}</td>
                <td className="pr-3 py-1.5 text-right tabular-nums">{r.baseline ?? "—"}</td>
                <td className="pr-3 py-1.5 text-right tabular-nums font-semibold">{r.current ?? "NOT_VERIFIED"}</td>
                <td className={`pr-3 py-1.5 text-right tabular-nums ${(r.delta ?? 0) > 0 ? "text-amber-600" : ""}`}>{r.delta === null ? "—" : (r.delta > 0 ? `+${r.delta}` : r.delta)}</td>
                <td className="py-1.5 text-right text-stone-400" title="ยังไม่มีเป้าตัวเลขที่เจ้าของกำหนดใน authority — ไม่เดา">—</td>
              </tr>
            ))}
            <tr className="border-t">
              <td className="pr-3 py-1.5 font-mono text-xs">RULE_CONFLICTS</td>
              <td className="pr-3 py-1.5 text-right">—</td>
              <td className="pr-3 py-1.5 text-right tabular-nums font-semibold">{data.rule_conflicts ?? "NOT_VERIFIED"}</td>
              <td className="pr-3 py-1.5 text-right">—</td>
              <td className="py-1.5 text-right">—</td>
            </tr>
          </tbody>
        </table>
        <TechnicalDetailToggle>
          <div>authority: {data.authority}</div>
          <div className="mt-1.5">computed_at: {data.computed_at ?? "—"}</div>
          <div className="mt-1.5">rule_conflicts_note: {data.rule_conflicts_note}</div>
          {data.not_verified_reason && <div className="mt-1.5">not_verified_reason: {data.not_verified_reason}</div>}
          <div className="mt-1.5">
            evidence:
            <ul className="list-disc list-inside">
              {data.evidence.map((ev, i) => (<li key={i}>{ev}</li>))}
            </ul>
          </div>
        </TechnicalDetailToggle>
      </div>
    </SubSection>
  );
}

function ArchEmpty({ text }: { text: string }) {
  const { theme } = useTheme();
  const ty = typography[theme];
  return (
    <SubSection eyebrow="—" title="" tone="info">
      <p className={`text-center text-sm ${ty.description}`}>{text}</p>
    </SubSection>
  );
}

function outcomeTone(r: string): SemanticTone {
  if (r === "PASS") return "success";
  if (r === "FAIL" || r === "BLOCKED") return "error";
  return "info";
}

// หมวด 05 — TEST RESULTS: นับจากผลล่าสุดของแต่ละ command จริงเท่านั้น
// (ห้ามนับแถว history เป็นจำนวน test ปัจจุบัน) · Source SHA/USER_VERIFIED
// ยังไม่มีในทะเบียนเดิม — แสดง "—" ตามความจริง ไม่เติมเลย
function ArchTestResultsView({ data }: { data: TestResultsBlock | null }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  if (!data) {
    return <ArchEmpty text="TEST RESULTS — NOT_VERIFIED: the runtime did not return a test-results block." />;
  }
  return (
    <SubSection eyebrow="05 · TEST RESULTS" title="Test results — latest run per real test command" tone={data.counts.fail > 0 ? "warning" : "success"}>
      <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
        <StatusChip label="LIVE" tone="success" />
        <StatusChip label={`${data.counts.pass} PASS`} tone="success" />
        <StatusChip label={`${data.counts.fail} FAIL`} tone={data.counts.fail > 0 ? "error" : "success"} />
        <StatusChip label="SOURCE_SHA — / USER_VERIFIED —" tone="info" />
      </div>
      <div className={`p-5 rounded-lg ${e.card}`}>
        <p className={`text-xs ${ty.description}`}>
          นับจากผลล่าสุดของแต่ละ command ({data.counts.total_tests} command จริง) — ประวัติเก่าอีก {Math.max(0, data.history_rows - data.counts.total_tests)} แถวไม่ถูกนับเป็นการทดสอบปัจจุบัน
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="pr-3 py-1.5">Test ID</th>
              <th className="pr-3 py-1.5">Command</th>
              <th className="pr-3 py-1.5">RESULT</th>
              <th className="pr-3 py-1.5">LAST_RUN</th>
              <th className="py-1.5">EVIDENCE</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((t) => (
              <tr key={t.test_id} className="border-t">
                <td className="pr-3 py-1.5 font-mono text-xs">{t.test_id}</td>
                <td className="pr-3 py-1.5 font-mono text-xs break-all max-w-md">{t.command}</td>
                <td className="pr-3 py-1.5"><StatusChip label={t.result} tone={outcomeTone(t.result)} /></td>
                <td className="pr-3 py-1.5 text-xs whitespace-nowrap">{t.last_run ? new Date(t.last_run).toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
                <td className="py-1.5 text-xs">{t.evidence ? "จากรายการจริง (ดูตัวเต็มด้านล่าง)" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={`mt-3 text-xs ${ty.description}`}>{data.note}</p>
        <TechnicalDetailToggle>
          <div>authority: {data.authority}</div>
          <div className="mt-1.5">
            evidence ของแถวที่มีข้อความจริง:
            <ul className="list-disc list-inside">
              {data.entries.filter((t) => t.evidence).slice(0, 8).map((t) => (<li key={t.test_id}>{t.test_id}: {String(t.evidence).slice(0, 240)}</li>))}
            </ul>
          </div>
        </TechnicalDetailToggle>
      </div>
    </SubSection>
  );
}

// หมวด 04 — CAPABILITY READINESS: runtime_status จาก status เดิม (READY ได้
// เฉพาะ LIVE เท่านั้น — ห้ามให้ Source PASS กลับเป็น READY โดยอัตโนมัติ)
function ArchCapabilityReadinessView({ rows }: { rows: CapabilityReadinessEntry[] | null }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  if (!rows || rows.length === 0) {
    return <ArchEmpty text="CAPABILITY READINESS — NOT_VERIFIED: the runtime did not return a readiness block." />;
  }
  const readinessTone = (r: CapabilityReadinessEntry["readiness"]): SemanticTone =>
    r === "READY" ? "success" : r === "PARTIAL" ? "warning" : r === "BLOCKED" ? "error" : "info";
  return (
    <SubSection eyebrow="04 · CAPABILITY READINESS" title="Capability readiness — evidence table per real capability" tone="info">
      <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
        <StatusChip label="LIVE" tone="success" />
        <StatusChip label={`${rows.filter((r) => r.readiness === "READY").length}/${rows.length} READY`} tone="success" />
        <StatusChip label="Source PASS ≠ READY" tone="info" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((r) => (
          <div key={r.capability_id} className={`p-5 rounded-lg ${e.card}`}>
            <div className="flex items-start justify-between gap-2">
              <h4 className={`text-sm font-semibold ${ty.heading}`}>{r.capability_id}</h4>
              <StatusChip label={r.readiness} tone={readinessTone(r.readiness)} />
            </div>
            <p className={`mt-2 text-xs ${ty.description}`}>
              runtime {r.runtime_status} · test {r.test_status} · user {r.user_status} · rules ผูกได้ {r.rule_ids.length} ตัว · source paths {r.source_paths.length}
            </p>
            <TechnicalDetailToggle>
              <div>rule_ids: {r.rule_ids.length ? r.rule_ids.join(", ") : "— (ยังไม่มีผูกเชิงกลในทะเบียน — ห้ามเดา)"}</div>
              <div className="mt-1.5">source_paths: {r.source_paths.join(" | ")}</div>
              <div className="mt-1.5">api_paths: {r.api_paths.join(" | ")}</div>
              <div className="mt-1.5">permissions: {r.permissions.length ? r.permissions.join(", ") : "— (ยังไม่มี permission matrix รายความสามารถในทะเบียนเดิม)"}</div>
              <div className="mt-1.5">last_verified: {r.last_verified}</div>
              <div className="mt-1.5">
                evidence:
                <ul className="list-disc list-inside">
                  {r.evidence.map((ev, i) => (<li key={i}>{ev}</li>))}
                </ul>
              </div>
            </TechnicalDetailToggle>
          </div>
        ))}
      </div>
    </SubSection>
  );
}

// หมวด 07 — OPEN DEFECTS: findings เดิมจากทะเบียน audit · ข้อที่สถานะ RESOLVED
// ยังแสดงเครื่องหมาย "รอหลักฐาน retest+SHA" (resolution_evidence_complete=false)
// — ห้ามนับแก้แล้วลอย ๆ และห้ามลบ defect เพื่อให้ยอดลด
function ArchOpenDefectsView({ rows }: { rows: OpenDefectEntry[] | null }) {
  const { theme } = useTheme();
  if (!rows) {
    return <ArchEmpty text="OPEN DEFECTS — NOT_VERIFIED: the runtime did not return the findings ledger." />;
  }
  const open = rows.filter((r) => /RESOLVED|RESOLVED_BY_MANAGER/i.test(r.status));
  const unresolved = rows.length - open.length;
  return (
    <SubSection eyebrow="07 · OPEN DEFECTS" title="Open defects — findings from the real audit evidence" tone={unresolved > 0 ? "warning" : "success"}>
      <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
        <StatusChip label="LIVE" tone="success" />
        <StatusChip label={`${unresolved} unresolved`} tone={unresolved > 0 ? "warning" : "success"} />
        <StatusChip label={`${open.length} resolved (รอ retest+SHA)`} tone="info" />
      </div>
      {rows.length === 0 ? (
        <p className="text-center text-sm">ทะเบียน finding ว่างจริง ๆ (ไม่มีรายการให้แสดง)</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((r) => (
            <div key={r.defect_id} className={`p-5 rounded-lg ${elevation[theme].card}${/RESOLVED/i.test(r.status) ? "" : " ring-1 ring-amber-400/40"}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xs font-semibold">{r.defect_id}</span>
                <div className="flex gap-1.5">
                  {r.severity !== "UNKNOWN" && <StatusChip label={r.severity} tone="warning" />}
                  <StatusChip label={r.status} tone={/RESOLVED/i.test(r.status) ? "success" : "warning"} />
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed break-words">{(r.description ?? "(ไม่มีคำอธิบายในทะเบียน)").slice(0, 220)}</p>
              {!/RESOLVED/i.test(r.status) && (
                <p className="mt-1.5 text-[11px] text-amber-700">ยังเป็น defect ที่ต้องตามแก้ — ห้ามลบออกจากทะเบียนเพื่อให้ยอดลด</p>
              )}
              {/RESOLVED/i.test(r.status) && (
                <p className="mt-1.5 text-[11px] text-stone-500">ยังต้องมีผลทดสอบซ้ำ + Source SHA + หลักฐานยืนยันก่อนนับ RESOLVED จริง (ยังไม่ครบ)</p>
              )}
              <TechnicalDetailToggle>
                <div>type: {r.type ?? "—"}</div>
                <div className="mt-1.5">root_cause: {r.root_cause ?? "—"}</div>
                <div className="mt-1.5">rule_id: {r.rule_id ?? "— (ยังไม่มีผูกเชิงกล)"} · capability_id: {r.capability_id ?? "— (ยังไม่มีผูกเชิงกล)"}</div>
                <div className="mt-1.5">source_path: {r.source_path ?? "—"} · first_seen: {r.first_seen ?? "—"} · last_verified: {r.last_verified ?? "—"}</div>
                <div className="mt-1.5">resolution_evidence_complete: {String(r.resolution_evidence_complete)}</div>
              </TechnicalDetailToggle>
            </div>
          ))}
        </div>
      )}
    </SubSection>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import portals from '@/registry/portals.json';
import arch from '@/registry/architecture.json';
import businessCoverage from '@/registry/business-coverage.json';
import connectorLifecycle from '@/registry/connector-lifecycle.json';
import aiRegistry from '@/registry/AI_REGISTRY.json';
import aiSessions from '@/registry/AI_SESSIONS.json';
import systemHealth from '@/DNA_OS_HEALTH.json';
import { createBrowserSupabase } from '@/services/supabase/browser';
import {
  ArrowRight, BookOpen, CheckCircle, Cpu, Database, LayoutGrid, Plug, Shield, Bot, Server,
  Puzzle, Workflow, Layers, GitBranch, Building, Target, Users, Menu, X, Package, Store,
  FileText, LogIn, AlertTriangle, XCircle, Cable, Network,
} from 'lucide-react';
import { ThemeProvider, ThemeToggle, useTheme, elevation, typography, fontWeight, semanticColors, spacing, type SemanticTone } from '@/presentation/foundation/tokens';
import { SystemRealityReportSection } from '@/components/workspace/SystemRealityReportSection';

const iconMap: { [key: string]: React.ElementType } = {
  LayoutGrid, BookOpen, Cpu, Database, Plug, Shield, Bot, Server, Puzzle, Workflow, Layers,
  GitBranch, Building, Target, Users, Package, Store, FileText, LogIn, Network,
};

const coverageTone: { [key: string]: { icon: React.ElementType; label: string; tone: SemanticTone } } = {
  covered: { icon: CheckCircle, label: 'Available', tone: 'success' },
  partial: { icon: AlertTriangle, label: 'Partial', tone: 'warning' },
  not_covered: { icon: XCircle, label: 'Not Implemented', tone: 'error' },
};

const sessionTone: { [key: string]: SemanticTone } = {
  working: 'success',
  idle: 'info',
  blocked: 'warning',
  token_exhausted: 'error',
  submitted: 'info',
  unknown: 'info',
};

/**
 * DNA OS Operational Workspace — the live control surface and system entry
 * point. NOT a landing page, NOT a product brochure (Main Domain UI
 * Operational Conversion, owner, 2026-08-04). Local nav is intentionally
 * decoupled from registry/portals.json's shared nav (used by /products,
 * /business, PortalShell) so this refactor stays scoped to this page only.
 * Section content still reads from the registry — no hardcoded business
 * data. All color/elevation/typography comes from styles/tokens/* — no
 * inline Tailwind palette colors.
 *
 * Every section below keeps its original route/anchor and underlying data
 * source (architecture-book.json, AI_SESSIONS.json, connector-lifecycle.json,
 * business-coverage.json, architecture.json, portals.json, owner-context.json,
 * AI_REGISTRY.json) — only labels, framing, and the addition of a real
 * Workspace launcher grid changed. Where this conversion needed a real data
 * source this file does not import (e.g. live Database/System Health
 * status), the tile says UNKNOWN with a stated reason rather than fabricate
 * a number — see StatusTile below.
 */
const WORKSPACE_NAV_HREFS = {
  Workspace: '#workspace',
  Control: '#platform',
  SystemMap: '#architecture',
  Capabilities: '#modules',
  Connections: '#ecosystem',
  Engineering: '/start',
  Knowledge: '/admin',
  Observation: '/observer',
  // Integrated Development Workspace (owner, 2026-08-05) — the VS Code-shaped
  // Application Shell (components/ide-shell/IDEWorkspace.tsx). Real route,
  // added here so it's reachable from the Owner Control Center rather than
  // an orphan page only reachable by typing the URL.
  IDE: '/admin/ide',
} as const;

// Operator identity (name, company, DBD registration, contact email) must not
// reach the client bundle: this component is 'use client', so importing
// registry/owner-context.json here shipped the whole owner record to every
// authenticated session (Directive 007 boundary, 2026-10-27). The host page
// (app/admin/operations/page.tsx, server) reads it server-side only and passes
// just the fields this UI displays.
// Architecture-book (3.9 MB, 1416 module nodes) must not be imported into this
// client bundle: the UI reads only summary.broken/ok/total. The server page
// passes those three numbers (plus unused/unregistered for display safety) via
// the archSummary prop (Perf directive 009, summary-only DTO).
export interface ArchBookSummaryInput {
  broken: number;
  ok: number;
  total: number;
  unused: number;
  unregistered: number;
  version?: string;
  generated_at?: string;
}

export interface OwnerContextInput {
  identity: { company: string; email: string };
  current_goals: { long_term: string };
  philosophy: { core: string };
}

export default function OperationalWorkspace({ ownerContext, archSummary }: { ownerContext: OwnerContextInput; archSummary: ArchBookSummaryInput }) {
  return (
    <ThemeProvider>
      <OperationalWorkspaceContent ownerContext={ownerContext} archSummary={archSummary} />
    </ThemeProvider>
  );
}

function OperationalWorkspaceContent({ ownerContext, archSummary }: { ownerContext: OwnerContextInput; archSummary: ArchBookSummaryInput }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Live operational data (Root Domain UI Conversion, owner, 2026-08-05):
  // everything else on this page comes from a registry JSON snapshotted at
  // build time — these two are real runtime state, refreshed on mount and
  // kept live via Supabase Realtime, same pattern as
  // app/admin/dev-loop/DevLoopDashboard.tsx. No fabricated fallback: null
  // renders as "Checking…", never a guessed number.
  const [dbHealth, setDbHealth] = useState<{ ok: boolean; latency_ms: number } | null>(null);
  const [latestBill, setLatestBill] = useState<{ amount_usd: number; amount_thb: number; status: string; email_received_at: string } | null>(null);

  const loadLiveStatus = useCallback(async () => {
    const client = createBrowserSupabase();
    const [{ data: gw }, { data: bill }] = await Promise.all([
      client
        .from('integration_gateway_events')
        .select('evidence')
        .eq('provider', 'supabase')
        .eq('capability', 'database.health.observed')
        .order('occurred_at', { ascending: false })
        .limit(1),
      client
        .from('supabase_billing_events')
        .select('amount_usd, amount_thb, status, email_received_at')
        .order('email_received_at', { ascending: false })
        .limit(1),
    ]);
    if (gw && gw[0]) setDbHealth(gw[0].evidence as { ok: boolean; latency_ms: number });
    if (bill && bill[0]) setLatestBill(bill[0] as { amount_usd: number; amount_thb: number; status: string; email_received_at: string });
  }, []);

  useEffect(() => {
    void loadLiveStatus();
    const client = createBrowserSupabase();
    const channel = client
      .channel('operational-workspace-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'integration_gateway_events' }, () => void loadLiveStatus())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supabase_billing_events' }, () => void loadLiveStatus())
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [loadLiveStatus]);

  const controlCenterPortal = portals.main.find(p => p.href === '/');
  const devPortal = portals.main.find(p => p.href === '/start');
  const docsPortal = portals.main.find(p => p.label === 'Documentation');
  const devPortalInfo = (portals.portals as any).developer_portal;

  const domainEntries = Object.entries(businessCoverage.domains);
  const coveredCount = domainEntries.filter(([, d]) => (d as any).status === 'covered').length;
  const layerEntries = Object.entries(arch.layers);

  // Workspace grid — the real entry point into every capability. Reads
  // registry/portals.json's workspace_categories + docs[] directly (Workspace
  // Transformation Directive, owner 2026-08-04): every link below already
  // existed as a real /admin/* page before this directive — zero new routes.
  const workspaceGroups = (portals as any).workspace_categories
    .map((cat: { id: string; label_en: string; label_th: string; icon: string }) => ({
      ...cat,
      items: (portals.docs as any[]).filter((d) => d.workspace_category === cat.id),
    }))
    .filter((g: { items: unknown[] }) => g.items.length > 0);

  // Labels read from registry/portals.json where a real registered label
  // exists (devPortal.label / docsPortal.label) — never a second hardcoded
  // copy of the same name. #admin's real identity (pure docs vs mixed
  // admin+docs) is an open question in registry/portals.json's
  // _main_nav_note — "Knowledge" here is the honest neutral name until
  // that's resolved, matching what the /admin section below also uses.
  const navItems = [
    { label: 'IDE', href: WORKSPACE_NAV_HREFS.IDE },
    { label: 'Workspace', href: WORKSPACE_NAV_HREFS.Workspace },
    { label: 'Control', href: WORKSPACE_NAV_HREFS.Control },
    { label: 'System Map', href: WORKSPACE_NAV_HREFS.SystemMap },
    { label: 'Capabilities', href: WORKSPACE_NAV_HREFS.Capabilities },
    { label: 'Connections', href: WORKSPACE_NAV_HREFS.Connections },
    { label: devPortal?.label ?? 'Engineering', href: devPortal?.href ?? WORKSPACE_NAV_HREFS.Engineering },
    { label: docsPortal?.label ?? 'System Workspace', href: docsPortal?.href ?? WORKSPACE_NAV_HREFS.Knowledge },
    { label: 'Observation', href: WORKSPACE_NAV_HREFS.Observation },
  ];

  return (
    <div className={`min-h-screen ${e.background} ${ty.body} font-sans`}>
      <header className={`fixed top-0 left-0 right-0 z-50 ${e.nav}`}>
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link href="/" className={`text-lg shrink-0 ${ty.heading} ${fontWeight.headline}`}>
            DNA OS
          </Link>
          <nav className="hidden lg:flex items-center gap-6 overflow-x-auto">
            {navItems.map(item => (
              <Link
                key={item.label}
                href={item.href}
                className={`text-sm transition-colors whitespace-nowrap ${ty.description} ${theme === 'dark' ? 'hover:text-white' : 'hover:text-[#0F172A]'}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden lg:flex items-center gap-3 shrink-0">
            <ThemeToggle />
            {controlCenterPortal && (
              <Link
                href={controlCenterPortal.href}
                className={`px-4 py-2 text-sm font-medium transition-colors ${ty.body} ${theme === 'dark' ? 'hover:text-white' : 'hover:text-[#0F172A]'}`}
              >
                Operations
              </Link>
            )}
            {devPortal && (
              <Link
                href={devPortal.href}
                className={theme === 'dark'
                  ? 'px-4 py-2 bg-white text-[#111827] rounded-md text-sm font-semibold hover:bg-[#E2E8F0] transition-colors'
                  : 'px-4 py-2 bg-[#0F172A] text-white rounded-md text-sm font-semibold hover:bg-[#1E293B] transition-colors'}
              >
                {devPortal.label}
              </Link>
            )}
          </div>
          <div className="lg:hidden flex items-center gap-3">
            <ThemeToggle />
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} aria-label="Toggle menu">
              {isMenuOpen ? <X className={`w-6 h-6 ${ty.body}`} /> : <Menu className={`w-6 h-6 ${ty.body}`} />}
            </button>
          </div>
        </div>
        {isMenuOpen && (
          <div className={`lg:hidden ${e.background} border-t ${e.divider} max-h-[80vh] overflow-y-auto`}>
            <nav className="flex flex-col p-4 gap-4">
              {navItems.map(item => (
                <Link key={item.label} href={item.href} className={`flex items-center gap-3 ${ty.description}`} onClick={() => setIsMenuOpen(false)}>
                  {item.label}
                </Link>
              ))}
              {controlCenterPortal && (
                <Link href={controlCenterPortal.href} className={`flex items-center gap-3 ${ty.description}`} onClick={() => setIsMenuOpen(false)}>
                  Operations
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className={spacing.container}>

        {/* Hero — Runtime Command Surface: real operational status, not a product pitch */}
        <section id="hero" className="pt-28 sm:pt-32 pb-14 sm:pb-20 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div>
            <span className={`inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest ${semanticColors[theme].success.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${semanticColors[theme].success.dot}`} />
              Operational Runtime
            </span>
            <h1 className={`mt-4 text-4xl sm:text-5xl leading-[1.1] ${ty.heading} ${fontWeight.headline}`}>
              DNA OS Operational Runtime
            </h1>

            {/* Real status tiles — every value below comes from a registry
                file already imported in this component. Where no real
                source exists for a listed status, the tile reads "Checking…"
                until the live query above resolves — never a guessed number. */}
            <dl className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl">
              <StatusTile label="Runtime" value={archSummary.broken === 0 ? 'Healthy' : 'Needs Inspection'} tone={archSummary.broken === 0 ? 'success' : 'warning'} />
              <StatusTile label="Registry" value={`${archSummary.ok}/${archSummary.total} OK`} tone="info" />
              <StatusTile label="Gateway" value={`${(arch.layers as any).gateway?.modules?.length ?? 0} modules`} tone="info" />
              <StatusTile
                label="Database"
                value={dbHealth ? (dbHealth.ok ? `Healthy · ${dbHealth.latency_ms}ms` : 'Unreachable') : 'Checking…'}
                tone={dbHealth ? (dbHealth.ok ? 'success' : 'error') : 'unknown'}
                reason={dbHealth ? undefined : 'live — waiting on integration_gateway_events (run npm run gateway:observe:supabase)'}
              />
              <StatusTile label="Connectors" value={`${connectorLifecycle.stages.length}-stage · ${arch.dynamic_registry.auth_types.length} auth types`} tone="info" />
              <StatusTile label="Workers" value={`${aiSessions.sessions.filter(s => s.status === 'working').length}/${aiRegistry.agents.length} active`} tone="info" />
              <StatusTile label="Deployment" value={archSummary.broken === 0 ? 'Passing' : `${archSummary.broken} issue(s)`} tone={archSummary.broken === 0 ? 'success' : 'warning'} />
              <StatusTile
                label="System Health"
                value={`${systemHealth.summary.passed}/${systemHealth.summary.total} checks · score ${systemHealth.governance_score}`}
                tone={systemHealth.summary.failed === 0 ? 'success' : 'warning'}
                reason={`generated ${systemHealth.generated_at}`}
              />
              <StatusTile
                label="Costs"
                value={latestBill ? `$${latestBill.amount_usd.toFixed(2)} · ${latestBill.status.replace(/_/g, ' ')}` : 'Checking…'}
                tone={latestBill ? (latestBill.status === 'owner_notified' ? 'warning' : 'info') : 'unknown'}
                reason={latestBill ? `latest invoice, received ${latestBill.email_received_at}` : 'live — no billing_events yet'}
              />
            </dl>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              {controlCenterPortal && (
                <Link
                  href={controlCenterPortal.href}
                  className={theme === 'dark'
                    ? 'px-5 py-2.5 bg-white text-[#111827] rounded-md text-sm font-semibold hover:bg-[#E2E8F0] transition-colors'
                    : 'px-5 py-2.5 bg-[#0F172A] text-white rounded-md text-sm font-semibold hover:bg-[#1E293B] transition-colors'}
                >
                  Enter Operations
                </Link>
              )}
              <Link href={WORKSPACE_NAV_HREFS.IDE} className={`px-5 py-2.5 rounded-md text-sm font-semibold border transition-colors ${e.interactiveCard} ${ty.heading}`}>
                Open IDE Workspace
              </Link>
              {devPortal && (
                <Link href={devPortal.href} className={`px-5 py-2.5 rounded-md text-sm font-semibold border transition-colors ${e.interactiveCard} ${ty.heading}`}>
                  Open {devPortal.label}
                </Link>
              )}
              <Link href="#architecture" className={`px-5 py-2.5 rounded-md text-sm font-semibold ${ty.description}`}>
                Inspect System Map →
              </Link>
            </div>

            <div className={`mt-10 pt-6 border-t ${e.divider} flex flex-wrap gap-x-8 gap-y-4`}>
              <StatPill value={layerEntries.length} label="Layers" />
              <StatPill value={archSummary.total} label="Modules" />
              <StatPill value={`${coveredCount}/${domainEntries.length}`} label="Domains Covered" />
              <StatPill value={connectorLifecycle.stages.length} label="Stage Connector Lifecycle" />
            </div>
          </div>

          <HeroArchitectureDiagram layerEntries={layerEntries} broken={archSummary.broken} />
        </section>

        {/* System Reality Report — Owner Capability #57 (2026-08-10, STEP
            4+5, registry/TASK_QUEUE.json TASK-053 follow-on). Real, live,
            evidence-based answer to what works/doesn't/is connected today,
            in plain business language, sourced from a one-time real fetch
            to /api/admin/system-reality (app/api/admin/ide/_lib/
            systemRealityRuntime.ts's buildSystemRealityModel(), STEP 2+3,
            already built/tested — this section only renders it). Placed
            first, right after the hero, per the Owner's own instruction
            that this is meant to be the first, most important view. Self-
            contained component — see components/workspace/
            SystemRealityReportSection.tsx for the real 5-section render. */}
        <section id="system-reality" className={spacing.section}>
          <SectionHeading
            eyebrow="Owner System Reality Report"
            title="What Actually Works Right Now"
            description="Live, evidence-based status for every real business capability — computed fresh each time this page loads, never hardcoded or AI-summarized ad hoc."
          />
          <div className="mt-12">
            <SystemRealityReportSection />
          </div>
        </section>

        {/* Workspace — the real operational entry point */}
        <section id="workspace" className={spacing.section}>
          <SectionHeading
            eyebrow="Workspace"
            title="Every capability, one entry point"
            description="Grouped by what it does, not how it was built — every link below is a real page that already existed, only regrouped."
          />
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {workspaceGroups.map((group: { id: string; label_en: string; icon: string; items: { label: string; href: string }[] }) => (
              <WorkspaceCategoryCard key={group.id} group={group} />
            ))}
          </div>
        </section>

        {/* Control Overview — operational state, not a product article */}
        <section id="platform" className={spacing.section}>
          <SectionHeading
            eyebrow="Control"
            title="Current Operational State"
            description="Real registry and deployment status — not a description of what the platform is."
          />
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <InfoCard icon={Layers} title="Registry Health" description={`${archSummary.ok} operational, ${archSummary.unused} dormant, ${archSummary.unregistered} outside registry — of ${archSummary.total} total.`} />
            <InfoCard icon={Shield} title="Deployment Health" description={archSummary.broken === 0 ? 'All governance checks passing on the current build.' : `${archSummary.broken} module(s) currently need inspection.`} />
            <InfoCard icon={Cable} title="Connected Systems" description={`${aiRegistry.agents.length} registered AI agents, ${connectorLifecycle.stages.length}-stage connector lifecycle. Full list in Connections below.`} />
          </div>
          {/* Moved from app/page.tsx (Dead Board, "Platform Overview" section) —
              same fields (owner.current_goals.long_term, owner.philosophy.core,
              arch.note), same InfoCard component, unchanged. */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <InfoCard icon={Building} title="Purpose" description={ownerContext.current_goals.long_term} />
            <InfoCard icon={Target} title="Operating Principle" description={ownerContext.philosophy.core} />
            <InfoCard icon={Layers} title="Structure" description={arch.note} />
          </div>
          <div className={`mt-6 max-w-3xl mx-auto p-4 rounded-lg text-sm ${e.card} ${ty.description}`}>
            Running jobs, recent events, and issues awaiting review are not read by this component — see{' '}
            <Link href="/admin/event-inbox" className={semanticColors[theme].success.text}>Event Inbox</Link> for that live data.
          </div>
        </section>

        {/* Connections — external systems. Lifecycle diagram links through to
            /admin/connectors (real management page); individual agent/session
            chips have no per-item route registered, so they stay explicitly
            read-only per directive rather than link to a guessed destination. */}
        <section id="ecosystem" className={`${spacing.section} ${e.section} rounded-2xl px-4 sm:px-8`}>
          <SectionHeading
            eyebrow="Connections"
            title="External Systems"
            description={`Every external service goes through the same ${connectorLifecycle.stages.length}-stage connector lifecycle — no direct integrations, no shortcuts. Click any stage to open Connector management.`}
          />
          <Link href="/admin/connectors" className="block group">
            <div className="relative mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className={`hidden lg:block absolute top-9 left-[10%] right-[10%] h-px ${e.divider} border-t`} aria-hidden />
              {connectorLifecycle.stages.map((stage, i) => (
                <div key={stage} className={`relative rounded-lg p-4 text-center transition-colors ${e.card} ${e.interactiveCard}`}>
                  <div className={`text-xs font-mono ${ty.description}`}>{String(i + 1).padStart(2, '0')}</div>
                  <div className={`mt-2 font-semibold capitalize text-sm ${ty.heading}`}>{stage}</div>
                </div>
              ))}
            </div>
          </Link>
          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            {arch.dynamic_registry.auth_types.map((type) => (
              <span key={type} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${e.interactiveCard} ${ty.description}`}>
                <Cable className="w-3.5 h-3.5" /> {type}
              </span>
            ))}
          </div>

          <div className={`mt-16 pt-12 border-t ${e.divider}`}>
            <h3 className={`text-center text-xs font-semibold uppercase tracking-wide ${ty.description}`}>Workers and Model Connections</h3>
            <p className={`mt-3 text-center text-sm max-w-2xl mx-auto ${ty.body}`}>
              Any agent that follows the Constitution and Execution Contract is DNA OS Compatible — AI is a worker in the system, not the runtime.
              <span className="block mt-1 text-xs opacity-70">Read-only — no per-agent management route is registered yet.</span>
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-2.5">
              {aiRegistry.agents.map((a) => (
                <span key={a.id} className={`px-3.5 py-1.5 rounded-full text-xs capitalize ${e.interactiveCard} ${ty.body}`}>
                  {a.id.replace(/-/g, ' ')}{('vendor' in a && a.vendor) ? ` · ${a.vendor}` : ''}
                </span>
              ))}
            </div>
            <div className="mt-6 max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(aiRegistry as any).compatibility_contract?.requires?.map((r: string) => (
                <div key={r} className={`flex items-center gap-2 text-sm ${ty.body}`}>
                  <CheckCircle className={`w-4 h-4 shrink-0 ${semanticColors[theme].success.text}`} /> {r}
                </div>
              ))}
            </div>
            <div className="mt-8 max-w-2xl mx-auto">
              <h4 className={`text-xs font-semibold uppercase tracking-wide text-center mb-3 ${ty.description}`}>Active Worker Sessions</h4>
              <div className="space-y-2">
                {aiSessions.sessions.map((s) => {
                  const tone = sessionTone[s.status] ?? 'info';
                  return (
                    <div key={s.agent_id} className={`flex items-center justify-between gap-3 rounded-lg px-4 py-2 ${e.card}`}>
                      <span className={`text-xs font-mono truncate ${ty.description}`}>{s.agent_id}</span>
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${semanticColors[theme][tone].chip}`}>
                        {s.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Operational Coverage — each card is an entry point (opens the
            System Map, real and responds), not a marketing tile. No route
            maps a domain to one specific admin page, so all cards share the
            same honest real destination rather than a guessed one. */}
        <section id="domains" className={spacing.section}>
          <SectionHeading
            eyebrow="Operational Coverage"
            title="Available Business Capabilities"
            description={`${coveredCount} of ${domainEntries.length} operational domains are fully codified today — shown honestly, including the gaps.`}
          />
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {domainEntries.map(([key, domain]) => (
              <SolutionCard key={key} domainKey={key} domain={domain as any} />
            ))}
          </div>
        </section>

        {/* Engineering — same /start route, Engineering Workspace framing */}
        <section id="developer" className={spacing.section}>
          <SectionHeading
            eyebrow="Engineering"
            title="Build, Inspect, Test, Deploy"
            description={devPortalInfo?.purpose_th ?? 'Observer, API spec, Modules/Commands/Workflows/Constitution/Capabilities/Drivers, Examples, and Playground.'}
          />
          <div className="mt-10 flex justify-center">
            {devPortal && (
              <Link href={devPortal.href} className={`group flex items-center gap-4 rounded-lg px-6 py-5 max-w-lg w-full ${e.floatingSurface}`}>
                <BookOpen className={`w-6 h-6 shrink-0 ${ty.description}`} />
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold ${ty.heading}`}>{devPortal.label}</div>
                  <div className={`text-xs font-mono mt-0.5 ${ty.description}`}>{devPortal.href}</div>
                </div>
                <ArrowRight className={`w-5 h-5 shrink-0 transition-transform group-hover:translate-x-1 ${ty.description}`} />
              </Link>
            )}
          </div>
        </section>

        {/* Knowledge — route /admin unchanged. Its real identity (pure docs
            vs mixed admin+docs) is an open question in registry/portals.json
            (_main_nav_note / CURRENT_STATE.json open_questions[0]) — "System
            Workspace" is the honest neutral name used here until that's
            resolved, per instruction not to guess. */}
        <section id="documentation" className={spacing.section}>
          <SectionHeading
            eyebrow="Knowledge"
            title="System Workspace"
            description="The registry explorer and module documentation — architecture, rules, coverage, and connectors — generated directly from the codebase, not maintained separately. This route currently mixes documentation and real business admin pages; not yet split."
          />
          <div className="mt-10 flex justify-center">
            {docsPortal && (
              <Link href={docsPortal.href} className={`group flex items-center gap-4 rounded-lg px-6 py-5 max-w-lg w-full ${e.floatingSurface}`}>
                <FileText className={`w-6 h-6 shrink-0 ${ty.description}`} />
                <div className="flex-1 min-w-0">
                  <div className={`font-semibold ${ty.heading}`}>{docsPortal.label}</div>
                  <div className={`text-xs font-mono mt-0.5 ${ty.description}`}>{docsPortal.href}</div>
                </div>
                <ArrowRight className={`w-5 h-5 shrink-0 transition-transform group-hover:translate-x-1 ${ty.description}`} />
              </Link>
            )}
          </div>
        </section>

        {/* Runtime footer — build/registry facts, not a website footer.
            Every field comes from a source already imported above; no live
            build/commit identifier is imported here, so it reads UNKNOWN
            rather than a fabricated value. */}
        <footer id="contact" className={`text-center py-16 border-t ${e.divider} space-y-1`}>
          <p className={`text-xs font-mono ${ty.description}`}>
            Build: UNKNOWN (no build identifier imported) · Registry v{archSummary.version ?? 'UNKNOWN'} · Generated {archSummary.generated_at ? new Date(archSummary.generated_at).toISOString() : 'UNKNOWN'}
          </p>
          <p className={`text-xs font-mono ${ty.description}`}>
            Runtime: {archSummary.broken === 0 ? 'Healthy' : 'Needs Inspection'} · Deployment: {archSummary.broken === 0 ? 'Passing' : `${archSummary.broken} issue(s)`}
          </p>
          {/* Moved from app/page.tsx (Dead Board footer) — same fields
              (owner.identity.company, owner.identity.email), unchanged. */}
          <p className={`text-sm ${ty.description}`}>
            © {new Date().getFullYear()} {ownerContext.identity.company}. All rights reserved. For inquiries, contact{' '}
            <a href={`mailto:${ownerContext.identity.email}`} className={semanticColors[theme].success.text}>{ownerContext.identity.email}</a>.
          </p>
        </footer>
      </main>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  const { theme } = useTheme();
  const ty = typography[theme];
  return (
    <div className="text-center">
      <p className={`text-xs font-semibold uppercase tracking-widest ${semanticColors[theme].success.text}`}>{eyebrow}</p>
      <h2 className={`mt-2 text-xl sm:text-2xl md:text-3xl ${ty.heading} ${fontWeight.heading}`}>{title}</h2>
      <p className={`mt-3 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed ${ty.description}`}>{description}</p>
    </div>
  );
}

function StatCard({ title, value, tone }: { title: string; value: number; tone: SemanticTone }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  return (
    <div className={`p-4 sm:p-6 rounded-lg ${e.card}`}>
      <p className={`text-xs sm:text-sm font-medium capitalize ${ty.description}`}>{title}</p>
      <p className={`text-2xl sm:text-4xl font-extrabold mt-2 sm:mt-3 ${semanticColors[theme][tone].text}`}>{value}</p>
    </div>
  );
}

function StatusTile({ label, value, tone, reason }: { label: string; value: string; tone: SemanticTone | 'unknown'; reason?: string }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  const isUnknown = tone === 'unknown';
  const dotClass = isUnknown ? 'bg-stone-400' : semanticColors[theme][tone as SemanticTone].dot;
  const textClass = isUnknown ? ty.description : semanticColors[theme][tone as SemanticTone].text;
  return (
    <div className={`p-3 rounded-lg ${e.card}`} title={reason}>
      <dt className={`text-[10px] uppercase tracking-wide font-semibold ${ty.description}`}>{label}</dt>
      <dd className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${textClass}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
        <span className="truncate">{value}</span>
      </dd>
    </div>
  );
}

function StatPill({ value, label }: { value: number | string; label: string }) {
  const { theme } = useTheme();
  const ty = typography[theme];
  return (
    <div>
      <div className={`text-lg font-extrabold tabular-nums ${ty.heading}`}>{value}</div>
      <div className={`text-[11px] uppercase tracking-wide ${ty.description}`}>{label}</div>
    </div>
  );
}

function HeroArchitectureDiagram({
  layerEntries,
  broken,
}: {
  layerEntries: [string, unknown][];
  broken: number;
}) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  const statusTone: SemanticTone = broken === 0 ? 'success' : 'warning';
  return (
    <div className={`rounded-lg overflow-hidden ${e.floatingSurface}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${e.divider}`}>
        <span className={`text-xs font-mono uppercase tracking-wide ${ty.description}`}>Runtime Layers</span>
        <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${semanticColors[theme][statusTone].chip}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${semanticColors[theme][statusTone].dot}`} />
          {broken === 0 ? 'Runtime Healthy' : `${broken} Require Inspection`}
        </span>
      </div>
      <div className="p-3">
        {layerEntries.map(([key, layer], i) => {
          const l = layer as any;
          const Icon = iconMap[l.icon] || Layers;
          const isLast = i === layerEntries.length - 1;
          return (
            <div key={key} className="group block">
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-md ${e.interactiveCard} mb-0.5`}>
                <span className={`text-[10px] font-mono w-4 shrink-0 ${ty.description}`}>{String(i + 1).padStart(2, '0')}</span>
                <Icon className={`w-4 h-4 shrink-0 ${ty.description}`} />
                <span className={`text-sm font-medium flex-1 min-w-0 truncate ${ty.heading}`}>{l.name}</span>
                <span className={`text-[10px] font-mono shrink-0 ${ty.description}`}>{l.modules.length} mod</span>
              </div>
              {!isLast && <div className={`ml-[26px] w-px h-1.5 border-l ${e.divider}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkspaceCategoryCard({ group }: { group: { id: string; label_en: string; icon: string; items: { label: string; href: string }[] } }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  const Icon = iconMap[group.icon] || LayoutGrid;
  return (
    <div className={`p-5 sm:p-6 rounded-lg ${e.card}`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${ty.description}`} />
        <h3 className={`text-base font-semibold ${ty.heading}`}>{group.label_en}</h3>
        <span className={`ml-auto text-[10px] font-mono ${ty.description}`}>{group.items.length}</span>
      </div>
      <div className="mt-4 flex flex-col gap-1">
        {group.items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`group flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${e.interactiveCard} ${ty.body}`}
          >
            <span className="truncate">{item.label}</span>
            <ArrowRight className={`w-3.5 h-3.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${ty.description}`} />
          </Link>
        ))}
      </div>
    </div>
  );
}

function InfoCard({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  return (
    <div className={`p-6 sm:p-8 rounded-lg ${e.card}`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${ty.description}`} />
        <h3 className={`text-base font-semibold ${ty.heading}`}>{title}</h3>
      </div>
      <p className={`mt-4 text-sm leading-relaxed ${ty.body}`}>{description}</p>
    </div>
  );
}

function PipelineNode({ href, icon: Icon, title, description, count, index = 0, isLast }: { href: string; icon: React.ElementType; title: string; description: string; count: number; index?: number; isLast?: boolean }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-mono ${e.card} ${ty.description}`}>
          {String(index + 1).padStart(2, '0')}
        </div>
        {!isLast && <div className={`w-px flex-1 border-l ${e.divider} mt-1`} />}
      </div>
      <Link
        href={href}
        className={`group flex-1 min-w-0 rounded-lg px-5 py-4 mb-3 flex items-center gap-4 transition-colors ${e.card} ${
          theme === 'dark' ? 'hover:border-[#475569]' : 'hover:border-[#CBD5E1]'
        }`}
      >
        <Icon className={`w-5 h-5 shrink-0 ${ty.description}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`text-sm font-semibold ${ty.heading}`}>{title}</h3>
            <span className={`text-[10px] uppercase tracking-wide font-mono ${ty.description}`}>{count} modules</span>
          </div>
          <p className={`mt-1 text-xs line-clamp-2 ${ty.description}`}>{description}</p>
        </div>
        <span className={`hidden sm:inline text-[10px] uppercase tracking-wide font-semibold shrink-0 ${ty.description}`}>Inspect</span>
        <ArrowRight className={`w-4 h-4 shrink-0 transition-transform group-hover:translate-x-1 ${ty.description}`} />
      </Link>
    </div>
  );
}

function SolutionCard({ domainKey, domain }: { domainKey: string; domain: { label: string; status: string; modules: string[] } }) {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  const style = coverageTone[domain.status] || coverageTone.not_covered;
  const Icon = style.icon;
  return (
    <div className={`block p-6 rounded-lg transition-colors ${e.card} ${e.interactiveCard}`}>
      <div className="flex items-center justify-between">
        <h3 className={`text-base font-semibold capitalize ${ty.heading}`}>{domain.label}</h3>
        <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${semanticColors[theme][style.tone].chip}`}>
          <Icon className="w-3 h-3" /> {style.label}
        </span>
      </div>
      <p className={`mt-3 text-xs font-mono ${ty.description}`}>{domainKey}</p>
      <p className={`mt-2 text-sm ${ty.description}`}>{domain.modules?.length ?? 0} modules</p>
    </div>
  );
}

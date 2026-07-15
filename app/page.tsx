'use client';

import { useState } from 'react';
import Link from 'next/link';
import portals from '@/registry/portals.json';
import arch from '@/registry/architecture.json';
import owner from '@/registry/owner-context.json';
import businessCoverage from '@/registry/business-coverage.json';
import connectorLifecycle from '@/registry/connector-lifecycle.json';
import aiRegistry from '@/registry/AI_REGISTRY.json';
import aiSessions from '@/registry/AI_SESSIONS.json';
import archBook from '@/registry/architecture-book.json';
import {
  ArrowRight, BookOpen, CheckCircle, Cpu, Database, LayoutGrid, Plug, Shield, Bot, Server,
  Puzzle, Workflow, Layers, GitBranch, Building, Target, Users, Menu, X, Package, Store,
  FileText, LogIn, AlertTriangle, XCircle, Cable,
} from 'lucide-react';
import { ThemeProvider, ThemeToggle, useTheme, elevation, typography, fontWeight, semanticColors, spacing, type SemanticTone } from '@/styles/tokens';

const iconMap: { [key: string]: React.ElementType } = {
  LayoutGrid, BookOpen, Cpu, Database, Plug, Shield, Bot, Server, Puzzle, Workflow, Layers,
  GitBranch, Building, Target, Users, Package, Store, FileText, LogIn,
};

const coverageTone: { [key: string]: { icon: React.ElementType; label: string; tone: SemanticTone } } = {
  covered: { icon: CheckCircle, label: 'Covered', tone: 'success' },
  partial: { icon: AlertTriangle, label: 'Partial', tone: 'warning' },
  not_covered: { icon: XCircle, label: 'Planned', tone: 'error' },
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
 * DNA OS Landing Page — Operational Infrastructure Platform, not a product
 * brochure. Local nav is intentionally decoupled from registry/portals.json's
 * shared nav (used by /products, /business, PortalShell) so this refactor
 * stays scoped to this page only. Section content still reads from the
 * registry — no hardcoded business data. All color/elevation/typography
 * comes from styles/tokens/* — no inline Tailwind palette colors.
 */
const LANDING_NAV_HREFS = {
  Platform: '#platform',
  Architecture: '#architecture',
  Modules: '#modules',
  Ecosystem: '#ecosystem',
  Developer: '#developer',
  Documentation: '#documentation',
  Observer: '/observer',
} as const;

export default function LandingPage() {
  return (
    <ThemeProvider>
      <LandingPageContent />
    </ThemeProvider>
  );
}

function LandingPageContent() {
  const { theme } = useTheme();
  const e = elevation[theme];
  const ty = typography[theme];
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const controlCenterPortal = portals.main.find(p => p.label.includes('Control Center'));
  const devPortal = portals.main.find(p => p.label.includes('Developer Portal'));
  const docsPortal = portals.main.find(p => p.label === 'Documentation');
  const devPortalInfo = (portals.portals as any).developer_portal;

  const domainEntries = Object.entries(businessCoverage.domains);
  const coveredCount = domainEntries.filter(([, d]) => (d as any).status === 'covered').length;
  const layerEntries = Object.entries(arch.layers);

  const navItems = [
    { label: 'Platform', href: LANDING_NAV_HREFS.Platform },
    { label: 'Architecture', href: LANDING_NAV_HREFS.Architecture },
    { label: 'Modules', href: LANDING_NAV_HREFS.Modules },
    { label: 'Ecosystem', href: LANDING_NAV_HREFS.Ecosystem },
    { label: 'Developer', href: devPortal?.href ?? LANDING_NAV_HREFS.Developer },
    { label: 'Documentation', href: docsPortal?.href ?? LANDING_NAV_HREFS.Documentation },
    { label: 'Observer', href: LANDING_NAV_HREFS.Observer },
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
                Control Center
              </Link>
            )}
            {devPortal && (
              <Link
                href={devPortal.href}
                className={theme === 'dark'
                  ? 'px-4 py-2 bg-white text-[#111827] rounded-md text-sm font-semibold hover:bg-[#E2E8F0] transition-colors'
                  : 'px-4 py-2 bg-[#0F172A] text-white rounded-md text-sm font-semibold hover:bg-[#1E293B] transition-colors'}
              >
                Developer Portal
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
                  Control Center
                </Link>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className={spacing.container}>

        {/* Hero — two-column: positioning left, architecture diagram right */}
        <section id="hero" className="pt-28 sm:pt-32 pb-14 sm:pb-20 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div>
            <span className={`inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest ${semanticColors[theme].success.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${semanticColors[theme].success.dot}`} />
              Operational Infrastructure Platform
            </span>
            <h1 className={`mt-4 text-4xl sm:text-5xl leading-[1.1] ${ty.heading} ${fontWeight.headline}`}>
              DNA OS
            </h1>
            <p className={`mt-4 text-base leading-relaxed max-w-xl ${ty.body}`}>
              Build the coordination layer for workflows, business rules, documents, logistics, finance, AI, and operational execution — one governed system instead of disconnected scripts and dashboards.
            </p>

            <dl className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-xl">
              <QAItem label="What" answer="A rules-governed coordination layer that runs workflows, documents, logistics, finance, and AI as one operational system." />
              <QAItem label="Who" answer="System architects, developers integrating operational workflows, and enterprise operators running real business execution." />
              <QAItem label="Why" answer="The system must govern itself — the same rules apply no matter who is operating it, even as the team changes." />
              <QAItem label="How" answer={layerEntries.map(([, l]) => (l as any).name).join(' → ')} mono />
            </dl>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              {controlCenterPortal && (
                <Link
                  href={controlCenterPortal.href}
                  className={theme === 'dark'
                    ? 'px-5 py-2.5 bg-white text-[#111827] rounded-md text-sm font-semibold hover:bg-[#E2E8F0] transition-colors'
                    : 'px-5 py-2.5 bg-[#0F172A] text-white rounded-md text-sm font-semibold hover:bg-[#1E293B] transition-colors'}
                >
                  Open Control Center
                </Link>
              )}
              {devPortal && (
                <Link href={devPortal.href} className={`px-5 py-2.5 rounded-md text-sm font-semibold border transition-colors ${e.interactiveCard} ${ty.heading}`}>
                  Developer Portal
                </Link>
              )}
              <Link href="#architecture" className={`px-5 py-2.5 rounded-md text-sm font-semibold ${ty.description}`}>
                View architecture →
              </Link>
            </div>

            <div className={`mt-10 pt-6 border-t ${e.divider} flex flex-wrap gap-x-8 gap-y-4`}>
              <StatPill value={layerEntries.length} label="Layers" />
              <StatPill value={(archBook as any).summary?.total ?? 0} label="Modules" />
              <StatPill value={`${coveredCount}/${domainEntries.length}`} label="Domains Covered" />
              <StatPill value={connectorLifecycle.stages.length} label="Stage Connector Lifecycle" />
            </div>
          </div>

          <HeroArchitectureDiagram layerEntries={layerEntries} broken={(archBook as any).summary?.broken ?? 0} />
        </section>

        {/* Platform Overview */}
        <section id="platform" className={spacing.section}>
          <SectionHeading
            eyebrow="Platform Overview"
            title="What DNA OS is"
            description="A rules-governed coordination layer, not an application — every module, workflow, and integration in the business runs through the same Constitution and registry."
          />
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <InfoCard icon={Building} title="Purpose" description={owner.current_goals.long_term} />
            <InfoCard icon={Target} title="Operating Principle" description={owner.philosophy.core} />
            <InfoCard icon={Layers} title="Structure" description={arch.note} />
          </div>
        </section>

        {/* Architecture */}
        <section id="architecture" className={`${spacing.section} ${e.section} rounded-2xl px-4 sm:px-8`}>
          <SectionHeading
            eyebrow="Architecture"
            title="How the platform is layered"
            description="Every request moves through the same fixed sequence of layers — no layer calls another out of order, and every cross-layer import is declared in the dependency graph."
          />
          <div className="mt-12 flex flex-col gap-3 max-w-3xl mx-auto">
            {layerEntries.map(([key, layer], i) => (
              <PipelineNode
                key={key}
                index={i}
                isLast={i === layerEntries.length - 1}
                href={`/admin/architecture?layer=${key}`}
                icon={iconMap[(layer as any).icon] || Layers}
                title={(layer as any).name}
                description={(layer as any).purpose}
                count={(layer as any).modules.length}
              />
            ))}
          </div>
        </section>

        {/* Modules */}
        <section id="modules" className={spacing.section}>
          <SectionHeading
            eyebrow="Modules"
            title="Registry health"
            description="Generated directly from the codebase on every build — not a static claim about coverage."
          />
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total Modules" value={(archBook as any).summary?.total ?? 0} tone="info" />
            <StatCard title="OK" value={(archBook as any).summary?.ok ?? 0} tone="success" />
            <StatCard title="Unused" value={(archBook as any).summary?.unused ?? 0} tone="warning" />
            <StatCard title="Unregistered" value={(archBook as any).summary?.unregistered ?? 0} tone="error" />
          </div>
        </section>

        {/* Ecosystem */}
        <section id="ecosystem" className={`${spacing.section} ${e.section} rounded-2xl px-4 sm:px-8`}>
          <SectionHeading
            eyebrow="Ecosystem"
            title="Connectors and external agents"
            description={`Every external service goes through the same ${connectorLifecycle.stages.length}-stage connector lifecycle — no direct integrations, no shortcuts. AI agents are one class of worker in this ecosystem, not the center of it.`}
          />
          <div className="relative mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className={`hidden lg:block absolute top-9 left-[10%] right-[10%] h-px ${e.divider} border-t`} aria-hidden />
            {connectorLifecycle.stages.map((stage, i) => (
              <div key={stage} className={`relative rounded-lg p-4 text-center ${e.card}`}>
                <div className={`text-xs font-mono ${ty.description}`}>{String(i + 1).padStart(2, '0')}</div>
                <div className={`mt-2 font-semibold capitalize text-sm ${ty.heading}`}>{stage}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            {arch.dynamic_registry.auth_types.map((type) => (
              <span key={type} className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${e.interactiveCard} ${ty.description}`}>
                <Cable className="w-3.5 h-3.5" /> {type}
              </span>
            ))}
          </div>

          <div className={`mt-16 pt-12 border-t ${e.divider}`}>
            <h3 className={`text-center text-xs font-semibold uppercase tracking-wide ${ty.description}`}>AI Capability — Vendor-Agnostic Workers</h3>
            <p className={`mt-3 text-center text-sm max-w-2xl mx-auto ${ty.body}`}>
              Any agent that follows the Constitution and Execution Contract is DNA OS Compatible — AI is a worker in the system, not the runtime.
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
              <h4 className={`text-xs font-semibold uppercase tracking-wide text-center mb-3 ${ty.description}`}>Live Sessions</h4>
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

        {/* Operational Domains */}
        <section id="domains" className={spacing.section}>
          <SectionHeading
            eyebrow="Operational Domains"
            title="Business coverage"
            description={`${coveredCount} of ${domainEntries.length} operational domains are fully codified today — shown honestly, including the gaps.`}
          />
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {domainEntries.map(([key, domain]) => (
              <SolutionCard key={key} domainKey={key} domain={domain as any} />
            ))}
          </div>
        </section>

        {/* Developer */}
        <section id="developer" className={spacing.section}>
          <SectionHeading
            eyebrow="Developer"
            title="Build against the platform"
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

        {/* Documentation */}
        <section id="documentation" className={spacing.section}>
          <SectionHeading
            eyebrow="Documentation"
            title="Registry and architecture reference"
            description="The registry explorer and module documentation — architecture, rules, coverage, and connectors — generated directly from the codebase, not maintained separately."
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

        {/* Deployment */}
        <section id="deployment" className={spacing.section}>
          <SectionHeading
            eyebrow="Deployment"
            title="Operational status"
            description="Live governance check results for the currently deployed build."
          />
          <div className={`mt-10 max-w-2xl mx-auto p-6 sm:p-8 rounded-lg text-center ${e.floatingSurface}`}>
            <div className={`inline-flex items-center gap-2 ${(archBook as any).summary?.broken === 0 ? semanticColors[theme].success.text : semanticColors[theme].warning.text}`}>
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">{(archBook as any).summary?.broken === 0 ? 'All governance checks passing' : `${(archBook as any).summary?.broken} module(s) need attention`}</span>
            </div>
            <div className={`mt-4 text-sm ${ty.description}`}>
              {(archBook as any).summary?.ok}/{(archBook as any).summary?.total} modules OK — see the Documentation portal for the full registry explorer.
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer id="contact" className={`text-center py-16 border-t ${e.divider}`}>
          <p className={`text-sm ${ty.description}`}>
            © {new Date().getFullYear()} {owner.identity.company}. All rights reserved. For inquiries, contact{' '}
            <a href={`mailto:${owner.identity.email}`} className={semanticColors[theme].success.text}>{owner.identity.email}</a>.
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

function QAItem({ label, answer, mono }: { label: string; answer: string; mono?: boolean }) {
  const { theme } = useTheme();
  const ty = typography[theme];
  return (
    <div>
      <dt className={`text-[11px] font-semibold uppercase tracking-widest ${ty.description}`}>{label}</dt>
      <dd className={`mt-1.5 text-sm leading-relaxed ${mono ? `font-mono text-xs ${ty.mono}` : ty.body}`}>{answer}</dd>
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
        <span className={`text-xs font-mono uppercase tracking-wide ${ty.description}`}>Execution Architecture</span>
        <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${semanticColors[theme][statusTone].chip}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${semanticColors[theme][statusTone].dot}`} />
          {broken === 0 ? 'All checks passing' : `${broken} need attention`}
        </span>
      </div>
      <div className="p-3">
        {layerEntries.map(([key, layer], i) => {
          const l = layer as any;
          const Icon = iconMap[l.icon] || Layers;
          const isLast = i === layerEntries.length - 1;
          return (
            <Link key={key} href={`/admin/architecture?layer=${key}`} className="group block">
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-md ${e.interactiveCard} mb-0.5`}>
                <span className={`text-[10px] font-mono w-4 shrink-0 ${ty.description}`}>{String(i + 1).padStart(2, '0')}</span>
                <Icon className={`w-4 h-4 shrink-0 ${ty.description}`} />
                <span className={`text-sm font-medium flex-1 min-w-0 truncate ${ty.heading}`}>{l.name}</span>
                <span className={`text-[10px] font-mono shrink-0 ${ty.description}`}>{l.modules.length} mod</span>
              </div>
              {!isLast && <div className={`ml-[26px] w-px h-1.5 border-l ${e.divider}`} />}
            </Link>
          );
        })}
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
    <div className={`p-6 rounded-lg ${e.card}`}>
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

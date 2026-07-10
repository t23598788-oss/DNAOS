'use client';

import { useState, useMemo } from 'react';
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

const iconMap: { [key: string]: React.ElementType } = {
  LayoutGrid, BookOpen, Cpu, Database, Plug, Shield, Bot, Server, Puzzle, Workflow, Layers,
  GitBranch, Building, Target, Users, Package, Store, FileText, LogIn,
};

const navIconMap: { [key: string]: React.ElementType } = {
  'Control Center': Cpu,
  'User Portal': Users,
  'Partner Portal': Building,
  'Developer Portal': BookOpen,
  'Business Portal': Target,
  'Download Center': Package,
  'Documentation': FileText,
  'Login': LogIn,
};

const coverageStyle: { [key: string]: { icon: React.ElementType; label: string; className: string } } = {
  covered: { icon: CheckCircle, label: 'Covered', className: 'text-emerald-400 border-emerald-800 bg-emerald-950/40' },
  partial: { icon: AlertTriangle, label: 'Partial', className: 'text-amber-400 border-amber-800 bg-amber-950/40' },
  not_covered: { icon: XCircle, label: 'Planned', className: 'text-stone-500 border-stone-800 bg-stone-950/40' },
};

const sessionStatusStyle: { [key: string]: string } = {
  working: 'text-emerald-400 border-emerald-800 bg-emerald-950/40',
  idle: 'text-stone-400 border-stone-700 bg-stone-900/40',
  blocked: 'text-amber-400 border-amber-800 bg-amber-950/40',
  token_exhausted: 'text-rose-400 border-rose-800 bg-rose-950/40',
  submitted: 'text-sky-400 border-sky-800 bg-sky-950/40',
  unknown: 'text-stone-500 border-stone-800 bg-stone-950/40',
};

/**
 * DNA OS Landing Page — Operational Platform, not a brochure site.
 * All content is dynamically rendered from the project's registry files.
 * Adding a new module/domain/connector/agent updates this page automatically — no JSX changes needed.
 */
export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const controlCenterPortal = portals.main.find(p => p.label.includes("Control Center"));
  const devPortal = portals.main.find(p => p.label.includes("Developer Portal"));

  const domainEntries = Object.entries(businessCoverage.domains);
  const coveredCount = domainEntries.filter(([, d]) => (d as any).status === 'covered').length;

  return (
    <div className="min-h-screen bg-black text-stone-300 font-sans">
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/50 backdrop-blur-lg border-b border-stone-800">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link href="/" className="font-bold text-lg text-white shrink-0">
            {owner.identity.company}
          </Link>
          <nav className="hidden lg:flex items-center gap-6 overflow-x-auto">
            {portals.nav.map(item => (
              <Link key={item.label} href={item.href} className="text-sm text-stone-400 hover:text-white transition-colors whitespace-nowrap">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden lg:flex items-center gap-4 shrink-0">
            {controlCenterPortal && (
              <Link href={controlCenterPortal.href} className="px-4 py-2 text-sm font-medium text-stone-300 hover:text-white transition-colors">
                Login
              </Link>
            )}
            {devPortal && (
              <Link href={devPortal.href} className="px-4 py-2 bg-white text-black rounded-md text-sm font-semibold hover:bg-stone-200 transition-colors">
                Developer
              </Link>
            )}
          </div>
          <div className="lg:hidden">
            <button onClick={() => setIsMenuOpen(!isMenuOpen)} aria-label="Toggle menu">
              {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
        {isMenuOpen && (
          <div className="lg:hidden bg-black border-t border-stone-800 max-h-[80vh] overflow-y-auto">
            <nav className="flex flex-col p-4 gap-4">
              {portals.nav.map(item => {
                const Icon = navIconMap[item.label] || LayoutGrid;
                return (
                  <Link key={item.label} href={item.href} className="flex items-center gap-3 text-stone-400 hover:text-white" onClick={() => setIsMenuOpen(false)}>
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      <main className="max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8">

        {/* Hero */}
        <section id="hero" className="pt-40 sm:pt-48 pb-24 sm:pb-32 text-center">
          <div className="max-w-3xl mx-auto animate-[fadeIn_0.7s_ease-out]">
            <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-b from-white to-stone-400 leading-tight">
              {owner.identity.company}
            </h1>
            <p className="mt-6 text-base sm:text-lg md:text-xl text-stone-400">
              {owner.philosophy.core}
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              {controlCenterPortal && (
                <Link href={controlCenterPortal.href} className="w-full sm:w-auto text-center px-6 py-3 bg-white text-black rounded-lg text-sm font-semibold hover:bg-stone-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                  Go to {controlCenterPortal.label}
                </Link>
              )}
              {devPortal && (
                <Link href={devPortal.href} className="w-full sm:w-auto text-center px-6 py-3 bg-stone-900/50 text-stone-300 rounded-lg text-sm font-semibold hover:bg-stone-800/50 border border-stone-800 hover:border-stone-700 transition-colors">
                  {devPortal.label}
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* Platform Overview */}
        <section id="platform" className="py-16 sm:py-24">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white">The DNA OS Platform</h2>
            <p className="mt-4 max-w-3xl mx-auto text-base sm:text-lg text-stone-400">
              A self-governing business operating system built on a foundation of rules, architecture, and self-observation.
            </p>
          </div>
          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
            <InfoCard icon={Building} title="Vision" description={owner.current_goals.long_term} index={0} />
            <InfoCard icon={Target} title="Mission" description={owner.philosophy.core} index={1} />
            <InfoCard icon={Layers} title="Architecture" description={arch.note} index={2} />
          </div>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(arch.layers).map(([key, layer], i) => (
              <FeatureCard
                key={key}
                index={i}
                href={`/admin/architecture?layer=${key}`}
                icon={iconMap[(layer as any).icon] || Layers}
                title={(layer as any).name}
                description={(layer as any).purpose}
                count={(layer as any).modules.length}
                countLabel="Modules"
              />
            ))}
          </div>
        </section>

        {/* Products */}
        <section id="products" className="py-16 sm:py-24">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white">Products</h2>
            <p className="mt-4 max-w-3xl mx-auto text-base sm:text-lg text-stone-400">
              One Core, Gateway, Registry, and Database — every Portal below is a View of the same running system, not a separate build.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(portals.portals).map(([key, p], i) => (
              <PortalCard key={key} portal={p as any} index={i} />
            ))}
          </div>
        </section>

        {/* Solutions */}
        <section id="solutions" className="py-16 sm:py-24">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white">Solutions</h2>
            <p className="mt-4 max-w-3xl mx-auto text-base sm:text-lg text-stone-400">
              {coveredCount} of {domainEntries.length} business domains fully covered today — shown honestly, gaps included.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {domainEntries.map(([key, domain], i) => (
              <SolutionCard key={key} domainKey={key} domain={domain as any} index={i} />
            ))}
          </div>
        </section>

        {/* Marketplace */}
        <section id="marketplace" className="py-16 sm:py-24">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white">Marketplace</h2>
            <p className="mt-4 max-w-3xl mx-auto text-base sm:text-lg text-stone-400">
              Connect any external service — {connectorLifecycle.stages.length}-stage lifecycle, no exceptions, no shortcuts.
            </p>
          </div>
          <div className="relative mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="hidden lg:block absolute top-9 left-[10%] right-[10%] h-px bg-stone-800" aria-hidden />
            {connectorLifecycle.stages.map((stage, i) => (
              <div
                key={stage}
                style={{ opacity: 0, animationDelay: `${i * 90}ms`, animationFillMode: 'forwards' }}
                className="relative bg-stone-950 border border-stone-800 rounded-xl p-4 text-center hover:border-stone-700 transition-colors animate-[fadeIn_0.5s_ease-out]"
              >
                <div className="text-stone-600 text-xs font-mono">{String(i + 1).padStart(2, '0')}</div>
                <div className="mt-2 text-white font-semibold capitalize">{stage}</div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {arch.dynamic_registry.auth_types.map((type, i) => (
              <span
                key={type}
                style={{ opacity: 0, animationDelay: `${450 + i * 50}ms`, animationFillMode: 'forwards' }}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-stone-900/60 border border-stone-800 rounded-full text-xs text-stone-400 hover:border-stone-700 hover:text-stone-200 transition-colors animate-[fadeIn_0.4s_ease-out]"
              >
                <Cable className="w-3.5 h-3.5" /> {type}
              </span>
            ))}
          </div>
        </section>

        {/* AI Services */}
        <section id="ai-services" className="py-16 sm:py-24">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white">AI Services</h2>
            <p className="mt-4 max-w-3xl mx-auto text-base sm:text-lg text-stone-400">
              AI-agnostic by design — any agent that follows the Constitution and Execution Contract is DNA OS Compatible.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {aiRegistry.agents.map((a, i) => (
              <span
                key={a.id}
                style={{ opacity: 0, animationDelay: `${i * 40}ms`, animationFillMode: 'forwards' }}
                className="px-4 py-2 bg-stone-950 border border-stone-800 rounded-full text-sm text-stone-300 capitalize hover:border-stone-700 hover:text-white transition-colors animate-[fadeIn_0.4s_ease-out]"
              >
                {a.id.replace(/-/g, ' ')}{('vendor' in a && a.vendor) ? ` · ${a.vendor}` : ''}
              </span>
            ))}
          </div>
          <div className="mt-8 max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(aiRegistry as any).compatibility_contract?.requires?.map((r: string) => (
              <div key={r} className="flex items-center gap-2 text-sm text-stone-400">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> {r}
              </div>
            ))}
          </div>
          <div className="mt-10 max-w-2xl mx-auto">
            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide text-center mb-3">Live Sessions</h3>
            <div className="space-y-2">
              {aiSessions.sessions.map((s) => (
                <div key={s.agent_id} className="flex items-center justify-between gap-3 bg-stone-950/60 border border-stone-800 rounded-lg px-4 py-2">
                  <span className="text-xs font-mono text-stone-400 truncate">{s.agent_id}</span>
                  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${sessionStatusStyle[s.status] || sessionStatusStyle.unknown}`}>
                    {s.status}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 text-center">
              <Link href="/ai-services" className="text-xs text-stone-500 hover:text-stone-300 transition-colors">See full AI Services →</Link>
            </div>
          </div>
        </section>

        {/* Business Modules */}
        <section id="modules" className="py-16 sm:py-24">
          <div className="text-center">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white">Business Modules</h2>
            <p className="mt-4 max-w-3xl mx-auto text-base sm:text-lg text-stone-400">
              Live registry health — not a static claim, generated from the codebase itself.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total Modules" value={(archBook as any).summary?.total ?? 0} index={0} />
            <StatCard title="OK" value={(archBook as any).summary?.ok ?? 0} index={1} />
            <StatCard title="Unused" value={(archBook as any).summary?.unused ?? 0} index={2} />
            <StatCard title="Unregistered" value={(archBook as any).summary?.unregistered ?? 0} index={3} />
          </div>
        </section>

        {/* System Health & CTA */}
        <section id="status" className="py-16 sm:py-24">
          <div className="max-w-3xl mx-auto bg-stone-950 p-6 sm:p-8 rounded-2xl border border-stone-800 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Real-time System Status</h2>
            <div className="mt-6">
              <div className={`inline-flex items-center gap-2 ${(archBook as any).summary?.broken === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                <CheckCircle className="w-5 h-5" />
                <span className="font-semibold">{(archBook as any).summary?.broken === 0 ? 'All governance checks passing' : `${(archBook as any).summary?.broken} module(s) need attention`}</span>
              </div>
              <div className="mt-4 text-sm text-stone-500">
                {(archBook as any).summary?.ok}/{(archBook as any).summary?.total} modules OK — see /admin for the full registry explorer.
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer id="contact" className="text-center py-16 border-t border-stone-800/50">
            <p className="text-sm text-stone-500">© {new Date().getFullYear()} {owner.identity.company}. All rights reserved. For inquiries, contact <a href={`mailto:${owner.identity.email}`} className="text-blue-400 hover:text-blue-300">{owner.identity.email}</a>.</p>
        </footer>
      </main>
    </div>
  );
}

function StatCard({ title, value, index = 0 }: { title: string, value: number, index?: number }) {
  return (
    <div
      style={{ opacity: 0, animationDelay: `${index * 60}ms`, animationFillMode: 'forwards' }}
      className="bg-stone-950 p-4 sm:p-6 rounded-2xl border border-stone-800 hover:border-stone-700 transition-colors animate-[fadeIn_0.5s_ease-out]"
    >
      <p className="text-xs sm:text-sm font-medium text-stone-500 capitalize">{title}</p>
      <p className="text-3xl sm:text-5xl font-bold text-white mt-2 sm:mt-3">{value}</p>
    </div>
  );
}

function InfoCard({ icon: Icon, title, description, index = 0 }: { icon: React.ElementType, title: string, description: string, index?: number }) {
  return (
    <div
      style={{ opacity: 0, animationDelay: `${index * 80}ms`, animationFillMode: 'forwards' }}
      className="bg-stone-950 p-6 sm:p-8 rounded-2xl border border-stone-800 hover:border-stone-700 transition-colors animate-[fadeIn_0.5s_ease-out]"
    >
      <div className="flex items-center gap-3">
        <Icon className="w-6 h-6 text-stone-400" />
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      <p className="mt-4 text-stone-400">{description}</p>
    </div>
  );
}

function FeatureCard({ href, icon: Icon, title, description, count, countLabel, index = 0 }: { href: string, icon: React.ElementType, title: string, description: string, count: number, countLabel: string, index?: number }) {
  return (
    <Link
      href={href}
      style={{ opacity: 0, animationDelay: `${index * 60}ms`, animationFillMode: 'forwards' }}
      className="group block bg-stone-950 p-6 rounded-2xl border border-stone-800 hover:border-stone-700 hover:-translate-y-0.5 transition-all duration-300 animate-[fadeIn_0.5s_ease-out]"
    >
      <div className="flex items-center gap-3">
        <Icon className="w-6 h-6 text-stone-400" />
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      <p className="mt-3 text-sm text-stone-400 line-clamp-3">{description}</p>
      <div className="mt-4 pt-4 border-t border-stone-800/50 flex items-center justify-between">
        <span className="text-sm font-medium text-white">{count} <span className="text-stone-500">{countLabel}</span></span>
        <ArrowRight className="w-5 h-5 text-stone-700 group-hover:text-stone-400 transition-transform duration-300 group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function PortalCard({ portal, index = 0 }: { portal: { name: string; purpose_th: string; route: string; status: string }, index?: number }) {
  const isOfficial = portal.status === 'official';
  return (
    <Link
      href={portal.route}
      style={{ opacity: 0, animationDelay: `${index * 60}ms`, animationFillMode: 'forwards' }}
      className="group block bg-stone-950 p-6 rounded-2xl border border-stone-800 hover:border-stone-700 hover:-translate-y-0.5 transition-all duration-300 animate-[fadeIn_0.5s_ease-out]"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">{portal.name}</h3>
        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${isOfficial ? 'text-emerald-400 border-emerald-800 bg-emerald-950/40' : 'text-stone-500 border-stone-800 bg-stone-950/40'}`}>
          {isOfficial ? 'Live' : 'Shell'}
        </span>
      </div>
      <p className="mt-3 text-sm text-stone-400 line-clamp-3">{portal.purpose_th}</p>
      <div className="mt-4 pt-4 border-t border-stone-800/50 flex items-center justify-between">
        <span className="text-xs font-mono text-stone-500">{portal.route}</span>
        <ArrowRight className="w-5 h-5 text-stone-700 group-hover:text-stone-400 transition-transform duration-300 group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function SolutionCard({ domainKey, domain, index = 0 }: { domainKey: string; domain: { label: string; status: string; modules: string[] }, index?: number }) {
  const style = coverageStyle[domain.status] || coverageStyle.not_covered;
  const Icon = style.icon;
  return (
    <div
      style={{ opacity: 0, animationDelay: `${index * 60}ms`, animationFillMode: 'forwards' }}
      className="bg-stone-950 p-6 rounded-2xl border border-stone-800 hover:border-stone-700 hover:-translate-y-0.5 transition-all duration-300 animate-[fadeIn_0.5s_ease-out]"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-white capitalize">{domain.label}</h3>
        <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${style.className}`}>
          <Icon className="w-3 h-3" /> {style.label}
        </span>
      </div>
      <p className="mt-3 text-xs font-mono text-stone-600">{domainKey}</p>
      <p className="mt-2 text-sm text-stone-500">{domain.modules?.length ?? 0} modules</p>
    </div>
  );
}

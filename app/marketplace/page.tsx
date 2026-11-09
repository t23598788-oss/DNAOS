import type { Metadata } from 'next';
import arch from '@/registry/architecture.json';
import connectorLifecycle from '@/registry/connector-lifecycle.json';
import { Cable, ShieldCheck, AlertOctagon } from 'lucide-react';
import CapabilityPageShell from '@/presentation/shell/PortalShell';


export const metadata: Metadata = {
  title: "Marketplace | DNA OS",
  description: "วงจรชีวิตการเชื่อมต่อบริการภายนอกของ DNA OS และประเภทการเชื่อมต่อที่ระบบรองรับ",
  alternates: { canonical: "/marketplace" },
  openGraph: {
    title: "Marketplace | DNA OS",
    description: "วงจรชีวิตการเชื่อมต่อบริการภายนอกของ DNA OS และประเภทการเชื่อมต่อที่ระบบรองรับ",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Marketplace | DNA OS",
    description: "วงจรชีวิตการเชื่อมต่อบริการภายนอกของ DNA OS และประเภทการเชื่อมต่อที่ระบบรองรับ",
    images: ["/opengraph-image"],
  },
};

export default function MarketplacePage() {
  return (
    <CapabilityPageShell
      title="Marketplace"
      description={`Connect any external service — ${connectorLifecycle.stages.length}-stage lifecycle, no exceptions, no shortcuts.`}
    >
      <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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
      <div className="mt-10">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide text-center mb-4">Supported Connection Types</h2>
        <div className="flex flex-wrap justify-center gap-3">
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
      </div>
      <div className="mt-16 max-w-2xl mx-auto">
        <h2 className="flex items-center justify-center gap-2 text-sm font-semibold text-stone-500 uppercase tracking-wide mb-4">
          <ShieldCheck className="w-4 h-4" /> Rules
        </h2>
        <div className="space-y-2">
          {connectorLifecycle.rules.map((rule, i) => (
            <p key={i} className="text-sm text-stone-400 bg-stone-950/60 border border-stone-800 rounded-lg px-4 py-2.5">
              {rule}
            </p>
          ))}
        </div>
      </div>

      <div className="mt-12 max-w-2xl mx-auto">
        <h2 className="flex items-center justify-center gap-2 text-sm font-semibold text-stone-500 uppercase tracking-wide mb-4">
          <AlertOctagon className="w-4 h-4" /> If a Connector Fails
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {connectorLifecycle.failure_flow.map((step, i) => (
            <div key={step} className="bg-stone-950 border border-stone-800 rounded-xl p-4">
              <div className="flex items-center gap-2">
                <span className="text-stone-600 text-xs font-mono">{i + 1}</span>
                <span className="text-sm font-semibold text-white capitalize">{step.replace(/_/g, ' ')}</span>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                {(connectorLifecycle.failure_detail as Record<string, string>)[step]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </CapabilityPageShell>
  );
}

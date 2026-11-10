import type { Metadata } from 'next';
import aiRegistry from '@/registry/AI_REGISTRY.json';
import aiSessions from '@/registry/AI_SESSIONS.json';
import { CheckCircle } from 'lucide-react';
import CapabilityPageShell from '@/presentation/shell/PortalShell';

const sessionStatusStyle: { [key: string]: string } = {
  working: 'text-emerald-400 border-emerald-800 bg-emerald-950/40',
  idle: 'text-stone-400 border-stone-700 bg-stone-900/40',
  blocked: 'text-amber-400 border-amber-800 bg-amber-950/40',
  token_exhausted: 'text-rose-400 border-rose-800 bg-rose-950/40',
  submitted: 'text-sky-400 border-sky-800 bg-sky-950/40',
  unknown: 'text-stone-500 border-stone-800 bg-stone-950/40',
};

export const metadata: Metadata = {
  title: 'AI Services | DNA OS',
  description: 'รายชื่อ AI agent ที่ทำงานตาม Constitution และ Execution Contract ของ DNA OS — AI-agnostic by design',
  alternates: { canonical: '/ai-services' },
  openGraph: {
    title: 'AI Services | DNA OS',
    description: 'รายชื่อ AI agent ที่ทำงานตาม Constitution และ Execution Contract ของ DNA OS',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Services | DNA OS',
    description: 'รายชื่อ AI agent ที่ทำงานตาม Constitution และ Execution Contract ของ DNA OS',
    images: ['/opengraph-image'],
  },
};

export default function AIServicesPage() {
  return (
    <CapabilityPageShell
      title="AI Services"
      description="AI-agnostic by design — any agent that follows the Constitution and Execution Contract is DNA OS Compatible."
    >
      <div className="flex flex-wrap justify-center gap-3">
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
      <div className="mt-12 animate-[fadeIn_0.6s_ease-out]">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide text-center mb-6">{aiRegistry.compatibility_contract.title}</h2>
        <div className="max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
          {aiRegistry.compatibility_contract.requires.map((r) => (
            <div key={r} className="flex items-center gap-2 text-sm text-stone-400">
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" /> {r}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-16">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide text-center mb-6">Live Sessions</h2>
        <div className="max-w-3xl mx-auto space-y-3">
          {aiSessions.sessions.map((s, i) => (
            <div
              key={s.agent_id}
              style={{ opacity: 0, animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
              className="bg-stone-950 border border-stone-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 animate-[fadeIn_0.5s_ease-out]"
            >
              <div>
                <p className="text-sm font-mono text-stone-300">{s.agent_id}</p>
                <p className="text-xs text-stone-500 mt-1">
                  {s.provider}{s.model ? ` · ${s.model}` : ''} · last seen {s.last_seen ?? 'unknown'}
                </p>
              </div>
              <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border shrink-0 ${sessionStatusStyle[s.status] || sessionStatusStyle.unknown}`}>
                {s.status}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-stone-600">
          {aiSessions.note}
        </p>
      </div>
    </CapabilityPageShell>
  );
}

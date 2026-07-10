import moduleRegistry from '@/registry/module-registry.json';
import architectureBook from '@/registry/architecture-book.json';
import { Bot, CheckCircle, XCircle, GitBranch, Layers, Plug, Puzzle, Server, Workflow } from 'lucide-react';
import CopyButton from '@/components/landing/CopyButton';

function StatCard({ title, value, icon: Icon, delayMs = 0 }: { title: string, value: number, icon: React.ElementType, delayMs?: number }) {
  return (
    <div
      style={{ opacity: 0, animationDelay: `${delayMs}ms`, animationFillMode: 'forwards' }}
      className="bg-stone-950 p-6 rounded-xl border border-stone-800 hover:border-stone-700 transition-colors animate-[fadeIn_0.5s_ease-out]"
    >
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-stone-500" />
        <p className="text-sm font-medium text-stone-400">{title}</p>
      </div>
      <p className="text-5xl font-bold text-white mt-4">{value}</p>
    </div>
  );
}

/**
 * CEO Dashboard Page
 * Provides a high-level, strategic overview of the DNA OS ecosystem,
 * rendering all data directly from the system registry.
 */
export default function CeoDashboardPage() {
  const modules = Object.values(moduleRegistry.modules);
  const systemStats = {
    moduleCount: modules.length,
    layerCount: new Set(modules.map(m => m.layer)).size,
    serviceCount: modules.filter(m => m.layer === 'services').length,
    connectorCount: modules.filter(m => m.layer === 'plugins').length,
    aiCount: modules.filter(m => m.layer === 'cognitive').length,
    workflowCount: modules.filter(m => m.layer === 'engines').length,
    registryCount: modules.filter(m => m.layer === 'registry').length,
  };

  // สถานะจริงจาก architecture-book.json (สร้างโดย npm run arch) — ไม่ใช่ค่า hardcode
  const { broken, unused, unregistered, ok, total } = architectureBook.summary;
  const governancePassed = broken === 0;

  const healthChecks = [
    {
      name: 'Architecture Governance',
      detail: `${ok}/${total} OK · ${broken} broken · ${unused} unused · ${unregistered} unregistered`,
      passed: governancePassed,
      command: 'npm run arch',
    },
    { name: 'Type Safety', detail: 'ยังไม่มีสถานะสด — รันคำสั่งเพื่อตรวจสอบ', command: 'npm run type-check' },
    { name: 'Code Style & Linting', detail: 'ยังไม่มีสถานะสด — รันคำสั่งเพื่อตรวจสอบ', command: 'npm run lint' },
  ];

  return (
    <div className="p-8">
      <header className="animate-[fadeIn_0.4s_ease-out]">
        <h1 className="text-2xl font-bold text-white">CEO Dashboard</h1>
        <p className="text-stone-400 mt-1">A strategic overview of the DNA OS platform.</p>
      </header>

      {/* Key Metrics */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        <StatCard title="Total Modules" value={systemStats.moduleCount} icon={Puzzle} delayMs={0} />
        <StatCard title="Architecture Layers" value={systemStats.layerCount} icon={Layers} delayMs={40} />
        <StatCard title="AI / Cognitive" value={systemStats.aiCount} icon={Bot} delayMs={80} />
        <StatCard title="Workflows / Engines" value={systemStats.workflowCount} icon={Workflow} delayMs={120} />
        <StatCard title="Connectors / Plugins" value={systemStats.connectorCount} icon={Plug} delayMs={160} />
        <StatCard title="Services" value={systemStats.serviceCount} icon={Server} delayMs={200} />
        <StatCard title="Registries" value={systemStats.registryCount} icon={GitBranch} delayMs={240} />
      </div>

      {/* System Health */}
      <div className="mt-12 animate-[fadeIn_0.6s_ease-out]">
        <h2 className="text-lg font-semibold text-white">Platform Health</h2>
        <div className="mt-4 max-w-2xl bg-stone-950 p-4 rounded-xl border border-stone-800 divide-y divide-stone-800">
          <div className={`pb-3 mb-3 flex items-center gap-2 ${governancePassed ? 'text-emerald-400' : 'text-amber-400'}`}>
            {governancePassed ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            <span className="font-semibold">
              {governancePassed ? 'Architecture governance: clean' : `Architecture governance: ${broken} broken module(s)`}
            </span>
          </div>
          {healthChecks.map(check => (
            <div key={check.name} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
              <div>
                <span className="text-sm text-stone-300">{check.name}</span>
                <p className="text-[11px] text-stone-500">{check.detail}</p>
              </div>
              {check.passed === undefined ? (
                <div className="flex items-center gap-1 shrink-0">
                  <code className="text-[11px] text-stone-400 bg-stone-900 px-2 py-1 rounded">{check.command}</code>
                  <CopyButton text={check.command} />
                </div>
              ) : (
                <span className={`text-xs shrink-0 ${check.passed ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {check.passed ? 'Passed' : 'Attention needed'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
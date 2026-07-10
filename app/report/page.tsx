import existence from '@/registry/existence.json';
import businessCoverage from '@/registry/business-coverage.json';
import decisionCoverage from '@/registry/decision-coverage.json';
import ruleCoverage from '@/registry/rule-coverage.json';
import archBook from '@/registry/architecture-book.json';
import CapabilityPageShell from '@/components/landing/CapabilityPageShell';

function StatCard({ title, value, sub, delayMs = 0 }: { title: string; value: string; sub?: string; delayMs?: number }) {
  return (
    <div
      style={{ opacity: 0, animationDelay: `${delayMs}ms`, animationFillMode: 'forwards' }}
      className="bg-stone-950 p-6 rounded-2xl border border-stone-800 hover:border-stone-700 transition-colors animate-[fadeIn_0.5s_ease-out]"
    >
      <p className="text-xs sm:text-sm font-medium text-stone-500">{title}</p>
      <p className="text-3xl sm:text-4xl font-bold text-white mt-2">{value}</p>
      {sub && <p className="mt-1 text-xs text-stone-600">{sub}</p>}
    </div>
  );
}

/**
 * Report — the web rendering of the same real numbers behind
 * core/runtime/existence-intelligence.ts's Morning Report (CLI-only today).
 * Every number here is computed from a live registry file, not restated as a snapshot.
 */
export default function ReportPage() {
  const domainEntries = Object.entries(businessCoverage.domains);
  const coveredCount = domainEntries.filter(([, d]) => d.status === 'covered').length;

  const decisionValues = Object.values(decisionCoverage.decisions);
  const totalDecisionPoints = decisionValues.reduce((sum, d) => sum + d.total_decision_points, 0);
  const codifiedDecisionPoints = decisionValues.reduce((sum, d) => sum + d.codified, 0);
  const decisionCoveragePct = totalDecisionPoints > 0 ? Math.round((codifiedDecisionPoints / totalDecisionPoints) * 100) : 0;

  const enforcedRuleCount = Object.keys(ruleCoverage.rules).length;
  const uncoveredRuleCount = ruleCoverage.uncovered_rules.length;
  const totalRuleCount = enforcedRuleCount + uncoveredRuleCount;

  const capabilityEntries = Object.entries(existence.capabilities);
  const availableCapabilities = capabilityEntries.filter(([, c]) => c.status === 'available').length;

  return (
    <CapabilityPageShell
      title="Report"
      description="Live system status — the same numbers behind the Morning Report, generated from the registry itself, not a static claim."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Business Domains Covered" value={`${coveredCount}/${domainEntries.length}`} delayMs={0} />
        <StatCard title="Decision Coverage" value={`${decisionCoveragePct}%`} sub={`${codifiedDecisionPoints}/${totalDecisionPoints} decision points codified`} delayMs={60} />
        <StatCard title="Constitution Rules Enforced" value={`${enforcedRuleCount}/${totalRuleCount}`} delayMs={120} />
        <StatCard title="Capabilities Available" value={`${availableCapabilities}/${capabilityEntries.length}`} delayMs={180} />
      </div>

      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Modules Total" value={String(archBook.summary.total)} delayMs={240} />
        <StatCard title="Modules OK" value={String(archBook.summary.ok)} delayMs={280} />
        <StatCard title="Broken" value={String(archBook.summary.broken)} delayMs={320} />
        <StatCard title="Unregistered" value={String(archBook.summary.unregistered)} delayMs={360} />
      </div>

      <div className="mt-12">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide text-center mb-4">Decision Coverage by Category</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(decisionCoverage.decisions).map(([key, d], i) => (
            <div
              key={key}
              style={{ opacity: 0, animationDelay: `${420 + i * 60}ms`, animationFillMode: 'forwards' }}
              className="bg-stone-950 p-4 rounded-xl border border-stone-800 hover:border-stone-700 transition-colors animate-[fadeIn_0.5s_ease-out]"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-white capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="text-xs font-mono text-stone-500">{d.coverage_pct}%</span>
              </div>
              <div className="mt-2 h-1.5 bg-stone-900 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-600 transition-[width] duration-700 ease-out" style={{ width: `${d.coverage_pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-12">
        <h2 className="text-sm font-semibold text-stone-500 uppercase tracking-wide text-center mb-4">
          Constitution Rules Enforced ({enforcedRuleCount}/{totalRuleCount})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(ruleCoverage.rules).map(([num, rule], i) => (
            <div
              key={num}
              style={{ opacity: 0, animationDelay: `${i * 30}ms`, animationFillMode: 'forwards' }}
              className="bg-stone-950 border border-stone-800 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 animate-[fadeIn_0.4s_ease-out]"
            >
              <span className="text-sm text-stone-300 truncate">
                <span className="text-stone-600 font-mono mr-2">#{num}</span>{rule.title}
              </span>
              <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border text-stone-500 border-stone-800 shrink-0">
                {rule.type}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-stone-600">
          {uncoveredRuleCount} more rules (#{ruleCoverage.uncovered_rules.slice(0, 3).join(', #')}, …) are declared but not yet enforced in code.
        </p>
      </div>
    </CapabilityPageShell>
  );
}

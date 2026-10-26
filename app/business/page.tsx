/**
 * Business Workspace — CEO landing (securing pass, Cutover 008, 2026-10-27).
 *
 * This page previously rendered operator-platform metrics directly from
 * registry/module-registry.json and registry/architecture-book.json (module
 * counts, layer breakdown, governance health). Those are OPERATOR
 * infrastructure catalogs: per Security Cutover 008 step 4 they must not appear
 * in the business-facing workspace (which business administrators can reach),
 * so the registries are no longer imported or queried here.
 *
 * The route stays alive (nav links still point to /business) but now renders a
 * business-scoped summary only: no operator identity, no operator platform
 * topology, no registry-driven counts.
 */
import { Building2, ExternalLink, ShieldCheck } from 'lucide-react';

export default function CeoDashboardPage() {
  return (
    <div className="p-8">
      <header className="animate-[fadeIn_0.4s_ease-out]">
        <h1 className="text-2xl font-bold text-white">CEO Dashboard</h1>
        <p className="text-stone-400 mt-1">An overview of your business workspace.</p>
      </header>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-stone-950 p-6 rounded-xl border border-stone-800 hover:border-stone-700 transition-colors">
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-stone-500" />
            <p className="text-sm font-medium text-stone-400">Workspace</p>
          </div>
          <p className="text-sm text-stone-300 mt-4">
            Your company&apos;s operational workspace: documents, transactions,
            invoices, debts, products and partners.
          </p>
        </div>

        <div className="bg-stone-950 p-6 rounded-xl border border-stone-800 hover:border-stone-700 transition-colors">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-stone-500" />
            <p className="text-sm font-medium text-stone-400">Access</p>
          </div>
          <p className="text-sm text-stone-300 mt-4">
            Operator infrastructure and platform-level controls live in a
            separate, restricted workspace.
          </p>
        </div>

        <div className="bg-stone-950 p-6 rounded-xl border border-stone-800 hover:border-stone-700 transition-colors">
          <div className="flex items-center gap-3">
            <ExternalLink className="w-5 h-5 text-stone-500" />
            <p className="text-sm font-medium text-stone-400">Next</p>
          </div>
          <p className="text-sm text-stone-300 mt-4">
            Use the portal navigation to jump into documents, finance or
            partner areas.
          </p>
        </div>
      </div>
    </div>
  );
}

import PortalShell from "@/components/portal/PortalShell";
import businessCoverage from "@/registry/business-coverage.json";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";
import { CheckCircle } from "lucide-react";

const RELEVANT_DOMAINS = ["relationship", "purchase"] as const;
const PARTNER_ROLES = permissions.route_access.find(r => r.prefix === "/partner")!.roles as AppRole[];

export default async function PartnerPortalPage() {
  await requireAuthPage("/partner", PARTNER_ROLES);
  return (
    <PortalShell portalId="partner_portal">
      <div className="space-y-6">
        {RELEVANT_DOMAINS.map((key) => {
          const domain = businessCoverage.domains[key];
          if (!domain) return null;
          return (
            <div key={key} className="bg-stone-950 border border-stone-800 rounded-2xl p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">{domain.label}</h3>
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border text-emerald-400 border-emerald-800 bg-emerald-950/40">
                  <CheckCircle className="w-3 h-3" /> {domain.status}
                </span>
              </div>
              {'design_principle' in domain && domain.design_principle && (
                <p className="mt-2 text-sm text-stone-400">{domain.design_principle}</p>
              )}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Modules</p>
                  <div className="flex flex-wrap gap-1.5">
                    {domain.modules.map((m) => (
                      <span key={m} className="px-2 py-0.5 font-mono bg-stone-900 text-stone-400 rounded">{m}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Commands</p>
                  <div className="flex flex-wrap gap-1.5">
                    {domain.commands.map((c) => (
                      <span key={c} className="px-2 py-0.5 font-mono bg-stone-900 text-stone-400 rounded">{c}</span>
                    ))}
                  </div>
                </div>
              </div>
              {'gap' in domain && domain.gap && (
                <p className="mt-4 pt-4 border-t border-stone-800 text-xs text-amber-500">Gap: {domain.gap}</p>
              )}
            </div>
          );
        })}
      </div>
    </PortalShell>
  );
}

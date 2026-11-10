import type { Metadata } from 'next';
import businessCoverage from '@/registry/business-coverage.json';
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import CapabilityPageShell from '@/presentation/shell/PortalShell';

const coverageStyle: { [key: string]: { icon: React.ElementType; label: string; className: string } } = {
  covered: { icon: CheckCircle, label: 'Covered', className: 'text-emerald-400 border-emerald-800 bg-emerald-950/40' },
  partial: { icon: AlertTriangle, label: 'Partial', className: 'text-amber-400 border-amber-800 bg-amber-950/40' },
  not_covered: { icon: XCircle, label: 'Planned', className: 'text-stone-500 border-stone-800 bg-stone-950/40' },
};

export const metadata: Metadata = {
  title: 'Solutions | DNA OS',
  description: 'ความครอบคลุมของโดเมนธุรกิจที่ DNA OS รองรับวันนี้ พร้อมช่องว่างที่ยังเป็น Partial หรือ Planned ตามที่ registry ระบุจริง',
  alternates: { canonical: '/solutions' },
  openGraph: {
    title: 'Solutions | DNA OS',
    description: 'ความครอบคลุมของโดเมนธุรกิจที่ DNA OS รองรับวันนี้ พร้อมช่องว่างตามจริง',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Solutions | DNA OS',
    description: 'ความครอบคลุมของโดเมนธุรกิจที่ DNA OS รองรับวันนี้ พร้อมช่องว่างตามจริง',
    images: ['/opengraph-image'],
  },
};

export default function SolutionsPage() {
  const domainEntries = Object.entries(businessCoverage.domains);
  const coveredCount = domainEntries.filter(([, d]) => d.status === 'covered').length;

  return (
    <CapabilityPageShell
      title="Solutions"
      description={`${coveredCount} of ${domainEntries.length} business domains fully covered today — shown honestly, gaps included.`}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {domainEntries.map(([key, domain], i) => {
          const style = coverageStyle[domain.status] || coverageStyle.not_covered;
          const Icon = style.icon;
          return (
            <div
              key={key}
              style={{ opacity: 0, animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
              className="bg-stone-950 p-6 rounded-2xl border border-stone-800 hover:border-stone-700 hover:-translate-y-0.5 transition-all duration-300 animate-[fadeIn_0.5s_ease-out]"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white capitalize">{domain.label}</h3>
                <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${style.className}`}>
                  <Icon className="w-3 h-3" /> {style.label}
                </span>
              </div>
              <p className="mt-3 text-xs font-mono text-stone-600">{key}</p>
              <p className="mt-2 text-sm text-stone-500">{domain.modules?.length ?? 0} modules</p>
            </div>
          );
        })}
      </div>
    </CapabilityPageShell>
  );
}

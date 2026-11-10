import type { Metadata } from 'next';
import Link from 'next/link';
import portals from '@/registry/portals.json';
import { ArrowRight } from 'lucide-react';
import CapabilityPageShell from '@/presentation/shell/PortalShell';

export const metadata: Metadata = {
  title: 'Portals | DNA OS',
  description: 'ทุก Portal ใน DNA OS เป็น View ของระบบที่รันอยู่จริงชุดเดียว — Core, Gateway, Registry และ Database ไม่ใช่บิลด์แยก',
  alternates: { canonical: '/products' },
  openGraph: {
    title: 'Portals | DNA OS',
    description: 'ทุก Portal ใน DNA OS เป็น View ของระบบที่รันอยู่จริงชุดเดียว',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Portals | DNA OS',
    description: 'ทุก Portal ใน DNA OS เป็น View ของระบบที่รันอยู่จริงชุดเดียว',
    images: ['/opengraph-image'],
  },
};

export default function ProductsPage() {
  return (
    <CapabilityPageShell
      title="Products"
      description="One Core, Gateway, Registry, and Database — every Portal below is a View of the same running system, not a separate build."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(portals.portals).map(([key, p], i) => {
          const isOfficial = p.status === 'official';
          return (
            <Link
              key={key}
              href={p.route}
              style={{ opacity: 0, animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
              className="group block bg-stone-950 p-6 rounded-2xl border border-stone-800 hover:border-stone-700 hover:-translate-y-0.5 transition-all duration-300 animate-[fadeIn_0.5s_ease-out]"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">{p.name}</h3>
                <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${isOfficial ? 'text-emerald-400 border-emerald-800 bg-emerald-950/40' : 'text-stone-500 border-stone-800 bg-stone-950/40'}`}>
                  {isOfficial ? 'Live' : 'Shell'}
                </span>
              </div>
              <p className="mt-3 text-sm text-stone-400 line-clamp-3">{p.purpose_th}</p>
              <div className="mt-4 pt-4 border-t border-stone-800/50 flex items-center justify-between">
                <span className="text-xs font-mono text-stone-500">{p.route}</span>
                <ArrowRight className="w-5 h-5 text-stone-700 group-hover:text-stone-400 transition-transform duration-300 group-hover:translate-x-1" />
              </div>
            </Link>
          );
        })}
      </div>
    </CapabilityPageShell>
  );
}

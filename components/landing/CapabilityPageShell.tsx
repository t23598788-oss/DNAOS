import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * Shared header/footer shell for standalone capability pages (Products, Solutions,
 * Marketplace, AI Services, Report) that are also summarized as sections on the
 * Landing Page (/). Kept as its own component rather than reusing PortalShell.tsx,
 * since these are capability categories, not Portals in registry/portals.json's sense.
 * No client interactivity needed — stays a Server Component (zero client JS for this shell).
 */
export default function CapabilityPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black text-stone-300 font-sans">
      <header className="border-b border-stone-800">
        <div className="max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-stone-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" /> DNA OS
          </Link>
        </div>
      </header>
      <main className="max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="text-center mb-12 animate-[fadeIn_0.5s_ease-out]">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-white">{title}</h1>
          <p className="mt-4 max-w-2xl mx-auto text-base sm:text-lg text-stone-400">{description}</p>
        </div>
        {children}
      </main>
      <footer className="text-center py-16 border-t border-stone-800/50">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-300 transition-colors">← Back to DNA OS</Link>
      </footer>
    </div>
  );
}

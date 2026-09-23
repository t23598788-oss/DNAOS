/**
 * Shared loading skeleton for capability pages (Products/Solutions/Marketplace/
 * AI Services/Report) and Portal shells — matches CapabilityPageShell's layout
 * so there's no visual jump when real content replaces it. Pure presentation,
 * no data, no logic.
 */
export default function CapabilitySkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="min-h-screen bg-black">
      <div className="border-b border-stone-800 h-16" />
      <div className="max-w-screen-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="text-center mb-12 animate-pulse">
          <div className="h-10 sm:h-12 w-48 sm:w-64 bg-stone-900 rounded-lg mx-auto" />
          <div className="h-4 w-72 sm:w-96 bg-stone-900 rounded mx-auto mt-4" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="bg-stone-950 p-6 rounded-2xl border border-stone-800 h-32" />
          ))}
        </div>
      </div>
    </div>
  );
}

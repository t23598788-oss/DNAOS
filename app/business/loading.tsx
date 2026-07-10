/**
 * Loading skeleton for the CEO Dashboard, shaped like its real grid
 * (7 stat cards + a health list) so there's no layout jump on load.
 */
export default function Loading() {
  return (
    <div className="p-8 animate-pulse">
      <div className="h-8 w-56 bg-stone-900 rounded" />
      <div className="h-4 w-72 bg-stone-900 rounded mt-3" />
      <div className="mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="bg-stone-950 p-6 rounded-xl border border-stone-800 h-28" />
        ))}
      </div>
      <div className="mt-12">
        <div className="h-6 w-40 bg-stone-900 rounded" />
        <div className="mt-4 max-w-2xl bg-stone-950 p-4 rounded-xl border border-stone-800 h-40" />
      </div>
    </div>
  );
}

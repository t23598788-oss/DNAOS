export function ClarifyingChoice({
  prompt, options, active, onChoose,
}: { prompt: string; options: string[]; active: boolean; onChoose: (index: number) => void }) {
  return (
    <div className="bg-stone-800 border border-amber-800/50 rounded-2xl px-4 py-3 max-w-[85%]">
      <div className="text-sm text-stone-200 mb-2">{prompt}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((label, i) => (
          <button
            key={i}
            onClick={() => active && onChoose(i)}
            disabled={!active}
            className="text-xs px-3 py-1.5 rounded-full border border-amber-700 text-amber-300 hover:bg-amber-900/30 disabled:opacity-40 disabled:hover:bg-transparent transition"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

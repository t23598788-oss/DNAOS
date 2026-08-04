export function ResultCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="bg-stone-800 border border-stone-700 rounded-2xl px-4 py-3 max-w-[85%]">
      <div className="text-[10px] text-sky-400 uppercase font-semibold mb-1">{label}</div>
      <div className="text-sm text-stone-200 whitespace-pre-wrap leading-relaxed">{text}</div>
    </div>
  )
}

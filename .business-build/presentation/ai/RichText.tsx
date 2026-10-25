"use client";

/**
 * RichText — ข้อความธรรมดาของคำตอบ: wrap ตามพื้นที่จริง เก็บย่อหน้า + ขึ้น
 * บรรทัดใหม่ + รายการ (- / 1.) + markdown table (| … |) ไว้ครบ
 * (owner spec §7 — ไม่ตัดบรรทัดแบบกล่องแข็งเต็มความกว้าง)
 */

function cells(row: string): string[] {
  return row
    .replace(/^\s*\||\|\s*$/g, "")
    .split("|")
    .map((s) => s.trim());
}

function Block({ block }: { block: string }) {
  const lines = block.split("\n");
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isBullet = (l: string) => /^\s*[-*•]\s+/.test(l);
  const isOrdered = (l: string) => /^\s*\d+[.)]\s+/.test(l);

  if (lines.length >= 2 && lines.every(isTableRow)) {
    const [head, sep, ...body] = lines;
    const isSeparator = (r: string) => /^\s*\|[\s:|-]+\|\s*$/.test(r);
    const rows = isSeparator(sep ?? "") ? body : [sep, ...body].filter(Boolean);
    return (
      <div className="overflow-x-auto my-1">
        <table className="text-xs border border-stone-200 rounded-lg overflow-hidden w-full">
          <thead>
            <tr className="bg-stone-100">
              {cells(head).map((c, i) => (
                <th key={i} className="px-2 py-1.5 text-left font-semibold text-stone-600 border-b border-stone-200">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-b border-stone-100 last:border-0">
                {cells(r).map((c, ci) => (
                  <td key={ci} className="px-2 py-1.5 text-stone-700">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (lines.length > 0 && lines.every(isBullet)) {
    return (
      <ul className="list-disc pl-5 space-y-0.5 my-1">
        {lines.map((l, i) => (
          <li key={i}>{l.replace(/^\s*[-*•]\s+/, "")}</li>
        ))}
      </ul>
    );
  }

  if (lines.length > 0 && lines.every(isOrdered)) {
    return (
      <ol className="list-decimal pl-5 space-y-0.5 my-1">
        {lines.map((l, i) => (
          <li key={i}>{l.replace(/^\s*\d+[.)]\s+/, "")}</li>
        ))}
      </ol>
    );
  }

  return <p className="whitespace-pre-wrap">{block}</p>;
}

export function RichText({ text }: { text: string }) {
  const blocks = String(text ?? "")
    .split(/\n{2,}/)
    .filter((b) => b.trim().length > 0);
  if (blocks.length === 0) return null;
  return (
    <div className="text-sm leading-relaxed break-words min-w-0">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}

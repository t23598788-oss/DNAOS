'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * Small reusable copy-to-clipboard button. Kept as its own tiny Client Component
 * so pages that render it (e.g. the CEO Dashboard) can stay Server Components —
 * only this one interactive leaf ships client JS.
 */
export default function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 p-1.5 rounded-md text-stone-500 hover:text-white hover:bg-stone-800 transition-colors"
      aria-label={`Copy "${text}"`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

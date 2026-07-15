// Design Tokens — Semantic Colors
// Enterprise-muted status colors, not saturated "dashboard game" neon.
// Success = muted teal, Warning = muted amber, Error = muted crimson,
// Info/Neutral = slate blue. Dark-theme variants are lightened just enough
// to stay legible on a dark surface without becoming bright/neon.
//
// Tailwind v4 scans source files for literal class strings — it cannot see
// classes assembled from concatenated variables at runtime. Every class
// string below is written out in full so the scanner (and anyone reading
// the token file) can see exactly what will render.

import type { Theme } from './colors';

export type SemanticTone = 'success' | 'warning' | 'error' | 'info';

interface ToneClasses {
  text: string;
  chip: string; // text + background + border, for status badges/chips
  dot: string; // background, for small status dots
}

export const semanticColors: Record<Theme, Record<SemanticTone, ToneClasses>> = {
  light: {
    success: {
      text: 'text-[#0F766E]',
      chip: 'text-[#0F766E] bg-[rgba(15,118,110,0.08)] border-[rgba(15,118,110,0.35)]',
      dot: 'bg-[#0F766E]',
    },
    warning: {
      text: 'text-[#B45309]',
      chip: 'text-[#B45309] bg-[rgba(180,83,9,0.08)] border-[rgba(180,83,9,0.35)]',
      dot: 'bg-[#B45309]',
    },
    error: {
      text: 'text-[#B91C1C]',
      chip: 'text-[#B91C1C] bg-[rgba(185,28,28,0.08)] border-[rgba(185,28,28,0.35)]',
      dot: 'bg-[#B91C1C]',
    },
    info: {
      text: 'text-[#334155]',
      chip: 'text-[#334155] bg-[rgba(51,65,85,0.06)] border-[rgba(51,65,85,0.25)]',
      dot: 'bg-[#334155]',
    },
  },
  dark: {
    success: {
      text: 'text-[#5EEAD4]',
      chip: 'text-[#5EEAD4] bg-[rgba(15,118,110,0.18)] border-[rgba(94,234,212,0.35)]',
      dot: 'bg-[#2DD4BF]',
    },
    warning: {
      text: 'text-[#FCD34D]',
      chip: 'text-[#FCD34D] bg-[rgba(180,83,9,0.18)] border-[rgba(252,211,77,0.3)]',
      dot: 'bg-[#F59E0B]',
    },
    error: {
      text: 'text-[#FCA5A5]',
      chip: 'text-[#FCA5A5] bg-[rgba(185,28,28,0.18)] border-[rgba(252,165,165,0.3)]',
      dot: 'bg-[#F87171]',
    },
    info: {
      text: 'text-[#94A3B8]',
      chip: 'text-[#94A3B8] bg-[rgba(71,85,105,0.25)] border-[rgba(100,116,139,0.4)]',
      dot: 'bg-[#64748B]',
    },
  },
};

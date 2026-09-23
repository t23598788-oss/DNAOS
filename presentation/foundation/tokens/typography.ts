// Design Tokens — Typography
// Text-color layering (heading > body > description) plus the heavier
// headline weight enterprise consoles (AWS Console, Azure Portal, Stripe
// Dashboard, Vercel) use instead of thin/light display type.

import type { Theme } from './colors';

interface TypographyClasses {
  heading: string;
  body: string;
  description: string;
  mono: string;
}

export const typography: Record<Theme, TypographyClasses> = {
  light: {
    heading: 'text-[#0F172A]',
    body: 'text-[#334155]',
    description: 'text-[#64748B]',
    mono: 'text-[#475569]',
  },
  dark: {
    heading: 'text-[#F8FAFC]',
    body: 'text-[#CBD5E1]',
    description: 'text-[#94A3B8]',
    mono: 'text-[#94A3B8]',
  },
};

// Weight/tracking tokens — theme-independent.
export const fontWeight = {
  headline: 'font-extrabold tracking-[-0.04em]', // page H1 — 800, AWS-Console-style tight tracking
  heading: 'font-extrabold tracking-tight', // section H2/H3
  label: 'font-semibold uppercase tracking-widest',
};

// Design Tokens — Colors
// Raw palette only. Do not use these hex values directly in components —
// consume them through elevation.ts / typography.ts / semantic-colors.ts,
// which compose them into ready-to-use Tailwind arbitrary-value classes.
// Two themes: "light" (Enterprise Light, for operators/executives) and
// "dark" (Developer Dark, for engineers) — see ./index.tsx for the toggle.

export type Theme = 'light' | 'dark';

export const colors = {
  light: {
    background: '#F5F7FA',
    section: '#EEF2F7',
    card: '#FFFFFF',
    cardBorderStart: '#FFFFFF',
    cardBorderEnd: '#EDF1F6',
    interactiveCard: '#F1F5F9',
    interactiveCardHover: '#E8EDF3',
    floatingSurface: '#FFFFFF',
    border: '#E2E8F0',
    borderStrong: '#CBD5E1',
    navBg: 'rgba(245,247,250,0.78)',
    heading: '#0F172A',
    body: '#334155',
    description: '#64748B',
  },
  dark: {
    background: '#111827',
    section: '#182131',
    card: '#202B3E',
    cardGradientFrom: '#202B3E',
    cardGradientTo: '#1A2434',
    interactiveCard: '#2D3A50',
    interactiveCardHover: '#37465F',
    floatingSurface: '#1A2434',
    border: '#334155',
    borderStrong: '#475569',
    navBg: 'rgba(15,23,42,0.82)',
    heading: '#F8FAFC',
    body: '#CBD5E1',
    description: '#94A3B8',
  },
} as const;

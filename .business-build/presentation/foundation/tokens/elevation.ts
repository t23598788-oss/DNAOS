// Design Tokens — Elevation
// Five-layer surface system so the eye can separate page structure by
// luminance, not by guessing at near-identical dark-on-dark panels
// ("Dark Dashboard Syndrome"). Each layer is one step lighter than the one
// beneath it:
//
//   Background < Section < Card < Interactive Card < Floating Surface
//
// Cards use a subtle top-to-bottom gradient + a visible border instead of a
// flat fill, so they read as independent architectural layers rather than
// flat rectangles floating on the same plane as the page.

import type { Theme } from './colors';

interface ElevationClasses {
  background: string;
  section: string;
  card: string;
  interactiveCard: string;
  floatingSurface: string;
  nav: string;
  divider: string;
}

export const elevation: Record<Theme, ElevationClasses> = {
  light: {
    background: 'bg-[#F5F7FA]',
    section: 'bg-[#EEF2F7]',
    card: 'bg-white border border-[#E2E8F0] shadow-sm shadow-slate-900/[0.03]',
    interactiveCard:
      'bg-[#F1F5F9] border border-[#E2E8F0] hover:bg-[#E8EDF3] hover:border-[#CBD5E1] transition-colors',
    floatingSurface: 'bg-white border border-[#E2E8F0] shadow-lg shadow-slate-900/[0.06]',
    nav: 'bg-[rgba(245,247,250,0.78)] backdrop-blur-[18px] border-b border-[#E2E8F0]',
    divider: 'border-[#E2E8F0]',
  },
  dark: {
    background: 'bg-[#111827]',
    section: 'bg-[#182131]',
    card: 'bg-gradient-to-b from-[#202B3E] to-[#1A2434] border border-[#334155] shadow-sm shadow-black/20',
    interactiveCard:
      'bg-[#2D3A50] border border-[#334155] hover:bg-[#37465F] hover:border-[#475569] transition-colors',
    floatingSurface: 'bg-[#1A2434] border border-[#334155] shadow-lg shadow-black/40',
    nav: 'bg-[rgba(15,23,42,0.82)] backdrop-blur-[18px] border-b border-[#334155]',
    divider: 'border-[#334155]',
  },
};

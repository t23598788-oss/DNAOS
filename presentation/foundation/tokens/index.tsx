'use client';

// Design Tokens — barrel + Theme Provider
// "Enterprise Light" (operators/executives) vs "Developer Dark" (engineers)
// — DNA OS has more than one audience, so it should not force a single dark
// theme on everyone (same reasoning Azure/GitHub/Linear/Vercel apply).
// Persisted to localStorage; defaults to dark since this page is still
// primarily a developer/operator entry point.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Sun, Moon } from 'lucide-react';
import type { Theme } from './colors';

export type { Theme } from './colors';
export { colors } from './colors';
export { semanticColors, type SemanticTone } from './semantic-colors';
export { elevation } from './elevation';
export { typography, fontWeight } from './typography';
export { spacing } from './spacing';

const STORAGE_KEY = 'dna-os-theme';

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') setThemeState(stored);
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    window.localStorage.setItem(STORAGE_KEY, t);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <div className={`inline-flex items-center rounded-md border p-0.5 ${isDark ? 'border-[#334155] bg-[#182131]' : 'border-[#E2E8F0] bg-[#EEF2F7]'}`}>
      <button
        type="button"
        onClick={() => setTheme('light')}
        aria-pressed={!isDark}
        aria-label="Enterprise Light theme"
        title="Enterprise Light"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
          !isDark ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#64748B] hover:text-[#94A3B8]'
        }`}
      >
        <Sun className="w-3.5 h-3.5" />
        Light
      </button>
      <button
        type="button"
        onClick={() => setTheme('dark')}
        aria-pressed={isDark}
        aria-label="Developer Dark theme"
        title="Developer Dark"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
          isDark ? 'bg-[#2D3A50] text-white shadow-sm' : 'text-[#64748B] hover:text-[#334155]'
        }`}
      >
        <Moon className="w-3.5 h-3.5" />
        Dark
      </button>
    </div>
  );
}

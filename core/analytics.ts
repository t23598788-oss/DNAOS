/**
 * Client-side analytics helper.
 *
 * ONE rule: nothing here invents data and nothing runs on the server.
 * - `typeof window === "undefined"` → no-op (server components, RSC render).
 * - `window.gtag` undefined → no-op. That is the normal state when
 *   NEXT_PUBLIC_GA_ID is unset in the environment (app/layout.tsx then renders
 *   no gtag script at all), so callers never need to know whether analytics is
 *   configured.
 */
type GtagEventParams = Record<string, string | number | boolean | undefined>;

interface GtagWindow extends Window {
  gtag?: (command: string, target: string, params?: GtagEventParams) => void;
}

export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const w = window as GtagWindow;
  if (typeof w.gtag !== "function") return;
  w.gtag("event", name, params as GtagEventParams | undefined);
}

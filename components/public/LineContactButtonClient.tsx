"use client";

/**
 * Thin click-tracking wrapper for the SERVER-rendered LINE CTA.
 *
 * The server component (LineContactButton.tsx) owns the decision of whether a
 * real LINE link exists and passes that result down as `available` — this file
 * only reports the matching event, it never re-derives the URL or the state.
 *
 * Two events, because they mean different things:
 *   line_click              — a visitor clicked a real LINE link
 *   line_cta_unavailable    — a visitor clicked the honest "not configured"
 *                             panel (NEXT_PUBLIC_LINE_OA_URL unset), i.e.
 *                             demand exists but the channel is not live
 * Clicks on the register/login links INSIDE the unavailable panel are not
 * counted as LINE intent, so they are ignored here.
 */
import type { ReactNode } from "react";
import { trackEvent } from "@/core/analytics";

export interface LineContactButtonClientProps {
  available: boolean;
  location: string;
  children: ReactNode;
}

export default function LineContactButtonClient({ available, location, children }: LineContactButtonClientProps) {
  return (
    <span
      className="contents"
      onClickCapture={(event) => {
        if (!available && (event.target as HTMLElement).closest("a")) return;
        trackEvent(available ? "line_click" : "line_cta_unavailable", { location });
      }}
    >
      {children}
    </span>
  );
}

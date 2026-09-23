"use client";

import type { RenderModel } from "@/core/workspace/renderModel";

// Honest placeholder — Business/Finance/Partner/Mobile Board (Phase 4 Steps
// 5-8) are not implemented. Rendering guessed business content here (real
// revenue/debt/partner figures with no real data source) would violate this
// project's own rule against mock/fake data in source code, so this
// explicitly says "not implemented" instead of pretending.
export function NotImplementedBoard({ model }: { model: RenderModel }) {
  return (
    <div className="p-6 text-center">
      <div className="text-xs text-stone-400">
        {model.title || "This Board"} has no content yet — its real data source hasn't been specified.
      </div>
    </div>
  );
}
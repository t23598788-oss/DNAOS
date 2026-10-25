import type { RenderModel } from "./renderModel";

// Board Framework (Phase 4, Step 2) — the generic contract every Board
// implements. A Board receives RenderModel only, never a Business Engine,
// never a database handle, never a runtime reference. This is the literal
// imperative lifecycle the architecture spec names; components/workspace/boards/
// wraps it for React (a React component IS the natural mount/render/update/
// destroy cycle already, via mount/re-render/unmount) rather than duplicating
// a second lifecycle system on top of React's own.
export interface Board {
  initialize(): void;
  mount(container: HTMLElement): void;
  render(model: RenderModel): void;
  update(model: RenderModel): void;
  destroy(): void;
}

export type BoardType = "dashboard" | "business" | "finance" | "partner" | "mobile";
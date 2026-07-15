import type { ComponentType } from "react";
import type { RenderModel } from "./renderModel";
import type { BoardType } from "./board";
import { DashboardBoard } from "@/components/workspace/boards/DashboardBoard";
import { NotImplementedBoard } from "@/components/workspace/boards/NotImplementedBoard";

// Board Router (Phase 4, Step 9) — Workspace -> Presenter -> Board Router ->
// Selected Board. The only thing this file does is map a BoardType to the
// React component that renders it; it never imports or calls a Business
// Engine, database, or runtime — that boundary is structurally guaranteed
// by this file only importing components/workspace/boards/* and
// ./renderModel, nothing from @/engines, @/services, @/gateway, @/cognitive.
const BOARD_COMPONENTS: Record<BoardType, ComponentType<{ model: RenderModel }>> = {
  dashboard: DashboardBoard,
  business: NotImplementedBoard,
  finance: NotImplementedBoard,
  partner: NotImplementedBoard,
  mobile: NotImplementedBoard,
};

export function resolveBoard(type: BoardType): ComponentType<{ model: RenderModel }> {
  return BOARD_COMPONENTS[type] ?? NotImplementedBoard;
}
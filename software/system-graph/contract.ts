/**
 * หน้าที่: the public boundary of the system-graph projection.
 *
 * Output: `buildSystemGraph` and the graph types.
 * Dependency ที่อนุญาต: ./projection.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: this capability is READ-ONLY by construction — it exports
 * nothing that writes, executes, or decides. A viewer that consumes it can
 * therefore never reach an execution path through it.
 */

export { buildSystemGraph } from "./projection";
export type { BuildOptions } from "./projection";
export type {
  SystemGraph, GraphNode, GraphEdge, GraphNodeType, ConnectionType,
  EdgeRuntimeStatus, EdgeState, NodeRuntimeStatus,
} from "./types";

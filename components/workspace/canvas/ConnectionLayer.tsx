"use client";

import type { CanvasNode, CanvasConnection } from "./types";

const NODE_WIDTH = 224; // matches NodeRenderer's w-56
const PORT_ROW_HEIGHT = 18;
const PORTS_TOP_OFFSET = 62; // header + category label height, approximate

function portPosition(node: CanvasNode, port: string, side: "in" | "out", ports: string[]) {
  const index = ports.indexOf(port);
  const y = node.y + PORTS_TOP_OFFSET + Math.max(0, index) * PORT_ROW_HEIGHT + 6;
  const x = side === "in" ? node.x : node.x + NODE_WIDTH;
  return { x, y };
}

// Pure SVG rendering of the relationships already recorded in
// CanvasConnection[] — drawing a line here never calls, imports, or
// executes anything (requirement 11: connections only define relationships).
export function ConnectionLayer({
  nodes,
  connections,
  nodeInputPorts,
  nodeOutputPorts,
  onRemoveConnection,
}: {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  nodeInputPorts: (instanceId: string) => string[];
  nodeOutputPorts: (instanceId: string) => string[];
  onRemoveConnection: (id: string) => void;
}) {
  const byId = new Map(nodes.map((n) => [n.instanceId, n]));

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
      {connections.map((c) => {
        const from = byId.get(c.fromInstanceId);
        const to = byId.get(c.toInstanceId);
        if (!from || !to) return null;
        const start = portPosition(from, c.fromPort, "out", nodeOutputPorts(from.instanceId));
        const end = portPosition(to, c.toPort, "in", nodeInputPorts(to.instanceId));
        const midX = (start.x + end.x) / 2;
        const path = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
        return (
          <path
            key={c.id}
            d={path}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={1.5}
            className="pointer-events-auto cursor-pointer hover:stroke-red-400"
            onClick={() => onRemoveConnection(c.id)}
          />
        );
      })}
    </svg>
  );
}
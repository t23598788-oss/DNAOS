'use client'

/**
 * Renders real LINE Flex Message JSON (the same object actually sent via
 * registry/communication.ts's sendLineMessage()) as a visual card in the
 * admin control room — the same template, same wording, same numbers the
 * customer sees on their phone. Backend-only fields (ids, message tokens,
 * internal metadata) never reach this component; it only ever receives the
 * `contents` payload that was pushed to LINE.
 *
 * Owner request (2026-07-24): "อยากให้มันเป็นรูปแบบเดียวกัน ตัวหนังสือเดียวกัน
 * การ์ด Template เดียวกัน ข้อมูลเดียวกัน" — the admin screen must show exactly
 * what went out, not a separate internal summary/paraphrase of it.
 *
 * Covers the real bubble/box/text/separator/button element shapes produced
 * by every Flex builder in this codebase (engines/documents/flex-template.ts,
 * supabase/functions/line-webhook-v2/templates/flex/*.ts) — not a generic
 * full LINE Flex spec implementation, just the real subset actually used.
 */

type FlexNode = Record<string, any>

function resolveColor(c?: string): string | undefined {
  return c || undefined
}

function FlexText({ node }: { node: FlexNode }) {
  const size: Record<string, string> = {
    xxs: "10px", xs: "11px", sm: "13px", md: "15px", lg: "17px", xl: "19px",
  }
  return (
    <div
      style={{
        fontSize: size[node.size] ?? "13px",
        fontWeight: node.weight === "bold" ? 700 : 400,
        color: resolveColor(node.color) ?? "#111111",
        textAlign: node.align === "end" ? "right" : node.align === "center" ? "center" : "left",
        flex: typeof node.flex === "number" ? node.flex : undefined,
        whiteSpace: node.wrap ? "normal" : "nowrap",
        overflow: node.wrap ? "visible" : "hidden",
        textOverflow: node.wrap ? "clip" : "ellipsis",
        marginTop: node.margin ? marginPx(node.margin) : undefined,
      }}
    >
      {node.text}
    </div>
  )
}

function marginPx(m: string): number {
  const map: Record<string, number> = { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 }
  return map[m] ?? 4
}

function FlexSeparator({ node }: { node: FlexNode }) {
  return <div style={{ borderTop: "1px solid #e5e5e5", marginTop: marginPx(node.margin ?? "md"), marginBottom: 2 }} />
}

function FlexButton({ node }: { node: FlexNode }) {
  const primary = node.style === "primary"
  return (
    <div
      style={{
        marginTop: marginPx(node.margin ?? "sm"),
        padding: node.height === "sm" ? "6px 10px" : "10px 14px",
        borderRadius: 8,
        textAlign: "center",
        fontSize: 13,
        fontWeight: 600,
        flex: 1,
        background: primary ? (resolveColor(node.color) ?? "#1565C0") : "#f2f2f2",
        color: primary ? "#FFFFFF" : "#333333",
      }}
    >
      {node.action?.label ?? ""}
    </div>
  )
}

function FlexBox({ node }: { node: FlexNode }) {
  const horizontal = node.layout === "horizontal"
  return (
    <div
      style={{
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        gap: node.spacing ? marginPx(node.spacing) : 0,
        background: resolveColor(node.backgroundColor),
        padding: node.paddingAll ?? undefined,
        marginTop: node.margin ? marginPx(node.margin) : undefined,
        alignItems: horizontal ? "center" : "stretch",
      }}
    >
      {(node.contents ?? []).map((child: FlexNode, i: number) => (
        <FlexNode key={i} node={child} />
      ))}
    </div>
  )
}

function FlexNode({ node }: { node: FlexNode }) {
  if (!node || typeof node !== "object") return null
  switch (node.type) {
    case "box": return <FlexBox node={node} />
    case "text": return <FlexText node={node} />
    case "separator": return <FlexSeparator node={node} />
    case "button": return <FlexButton node={node} />
    default: return null
  }
}

export default function FlexPreview({ flex }: { flex: unknown }) {
  const bubble = flex as FlexNode
  if (!bubble || typeof bubble !== "object") return null

  const isMega = bubble.size === "mega"
  return (
    <div
      style={{
        width: isMega ? 320 : 260,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #e0e0e0",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        background: "#FFFFFF",
        fontFamily: "inherit",
      }}
    >
      {bubble.header && <FlexBox node={bubble.header} />}
      {bubble.body && <div style={{ padding: 12 }}><FlexBox node={bubble.body} /></div>}
      {bubble.footer && <div style={{ padding: 12, paddingTop: 0 }}><FlexBox node={bubble.footer} /></div>}
    </div>
  )
}

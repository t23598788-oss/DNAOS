// เรนเดอร์ LINE Flex JSON (เท่าที่ engines/documents/flex-template.ts สร้างเอง —
// bubble/box/text/separator เท่านั้น ไม่รองรับ Flex spec เต็มรูปแบบ) เป็นการ์ด
// HTML ให้แอดมินเห็นหน้าตาจริงก่อนกดยืนยันส่ง (owner request 2026-07-11:
// "ให้เห็นภาพรายการก่อนที่จะกดส่งยืนยัน... ไม่ใช่มีแต่ข้อความกดส่งไปเฉยๆ")

import type { CSSProperties } from "react"

type FlexNode = Record<string, unknown>

const SIZE_PX: Record<string, string> = { xxs: "10px", xs: "11px", sm: "13px", md: "15px", lg: "17px" }

function textStyle(node: FlexNode): CSSProperties {
  return {
    fontSize: SIZE_PX[String(node.size ?? "md")] ?? "13px",
    color: (node.color as string) ?? "#111111",
    fontWeight: node.weight === "bold" ? 700 : 400,
    textAlign: (node.align as CSSProperties["textAlign"]) ?? "start",
    whiteSpace: node.wrap ? "pre-wrap" : "nowrap",
    overflow: node.wrap ? "visible" : "hidden",
    textOverflow: "ellipsis",
    flex: typeof node.flex === "number" ? node.flex : undefined,
  }
}

function FlexNodeView({ node }: { node: FlexNode }) {
  switch (node.type) {
    case "text":
      return <div style={textStyle(node)}>{String(node.text ?? "")}</div>
    case "separator":
      return <div style={{ borderTop: "1px solid #ECECEC", margin: node.margin === "md" ? "8px 0" : "4px 0" }} />
    case "box": {
      const horizontal = node.layout === "horizontal"
      return (
        <div
          style={{
            display: "flex",
            flexDirection: horizontal ? "row" : "column",
            gap: node.spacing === "sm" ? "4px" : node.spacing === "md" ? "8px" : "2px",
            backgroundColor: (node.backgroundColor as string) ?? undefined,
            padding: node.paddingAll as string | undefined,
            marginTop: node.margin === "md" ? "8px" : node.margin === "sm" ? "4px" : undefined,
            alignItems: horizontal ? "center" : undefined,
          }}
        >
          {(node.contents as FlexNode[] ?? []).map((child, i) => (
            <FlexNodeView key={i} node={child} />
          ))}
        </div>
      )
    }
    case "bubble":
      return (
        <div style={{ width: 280, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.15)", background: "#fff" }}>
          {node.header ? <FlexNodeView node={node.header as FlexNode} /> : null}
          {node.body ? <div style={{ padding: "12px 16px" }}><FlexNodeView node={node.body as FlexNode} /></div> : null}
        </div>
      )
    default:
      return null
  }
}

export default function FlexPreview({ flex }: { flex: object }) {
  return (
    <div style={{ display: "inline-block" }}>
      <FlexNodeView node={flex as FlexNode} />
    </div>
  )
}

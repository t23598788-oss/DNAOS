// Quick Reply — let user pick vehicle type after specifying material

export function vehicleSelectQuickReply(): object[] {
  return [
    {
      type: "action",
      action: { type: "message", label: "รถพ่วง", text: "รถพ่วง" },
    },
    {
      type: "action",
      action: { type: "message", label: "รถสิบล้อ", text: "รถสิบล้อ" },
    },
    {
      type: "action",
      action: { type: "message", label: "รถหกล้อ", text: "รถหกล้อ" },
    },
    {
      type: "action",
      action: { type: "postback", label: "📍 ส่งพิกัด", data: "REQUEST_LOCATION" },
    },
  ]
}

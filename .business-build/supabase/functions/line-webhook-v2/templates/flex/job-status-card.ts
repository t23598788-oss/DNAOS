// Flex Message — job status summary sent to driver/customer

interface JobStatusCardProps {
  jobNo: string
  status: string
  material: string
  quantity: number
  destination: string
  driverName?: string
}

export function jobStatusCardFlex({
  jobNo,
  status,
  material,
  quantity,
  destination,
  driverName,
}: JobStatusCardProps): object {
  const statusColors: Record<string, string> = {
    ASSIGNED:        "#FFA000",
    IN_TRANSIT:      "#1565C0",
    DELIVERED:       "#2E7D32",
    COMPLETED:       "#2E7D32",
    CANCELLED:       "#C62828",
  }
  const color = statusColors[status] ?? "#555555"

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "horizontal",
      backgroundColor: color,
      contents: [
        {
          type: "text",
          text: `งาน ${jobNo}`,
          color: "#FFFFFF",
          weight: "bold",
          size: "md",
          flex: 1,
        },
        {
          type: "text",
          text: status,
          color: "#FFFFFF",
          size: "xs",
          align: "end",
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: `วัสดุ: ${material} ${quantity} ตัน`, size: "sm", wrap: true },
        { type: "text", text: `ปลายทาง: ${destination}`, size: "sm", wrap: true, color: "#555555" },
        ...(driverName ? [{ type: "text" as const, text: `คนขับ: ${driverName}`, size: "sm" as const }] : []),
      ],
    },
  }
}

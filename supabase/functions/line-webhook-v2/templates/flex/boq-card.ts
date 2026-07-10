// Flex Message — BOQ (Bill of Quantities) draft shown to customer before confirm

interface BoqLine {
  label: string
  amount: number
}

interface BoqCardProps {
  quoteId: string
  material: string
  quantity: number
  unitPrice: number
  lines: BoqLine[]
  totalAmount: number
}

export function boqCardFlex({
  quoteId,
  material,
  quantity,
  unitPrice,
  lines,
  totalAmount,
}: BoqCardProps): object {
  const lineRows = lines.map((l) => ({
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: l.label, size: "xs", color: "#555555", flex: 3 },
      {
        type: "text",
        text: l.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿",
        size: "xs",
        align: "end",
        flex: 2,
      },
    ],
  }))

  return {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#1565C0",
      contents: [
        { type: "text", text: "ใบประมาณราคา (BOQ)", color: "#FFFFFF", weight: "bold" },
        { type: "text", text: `#${quoteId}`, color: "#90CAF9", size: "xs" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "text",
          text: `${material} ${quantity} คิว × ${unitPrice.toLocaleString("th-TH")} ฿/คิว`,
          size: "sm",
          wrap: true,
        },
        { type: "separator" },
        ...lineRows,
        { type: "separator" },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "รวมทั้งสิ้น", weight: "bold", flex: 3 },
            {
              type: "text",
              text: totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿",
              weight: "bold",
              color: "#1565C0",
              align: "end",
              flex: 2,
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        {
          type: "button",
          action: { type: "postback", label: "ยืนยัน", data: `CONFIRM_JOB:${quoteId}` },
          style: "primary",
          color: "#2E7D32",
          height: "sm",
        },
        {
          type: "button",
          action: { type: "postback", label: "ยกเลิก", data: `CANCEL_JOB:${quoteId}` },
          style: "secondary",
          height: "sm",
        },
      ],
    },
  }
}

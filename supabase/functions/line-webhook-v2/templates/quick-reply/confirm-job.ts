// Quick Reply — yes/no confirm for job acceptance (used with plain text messages)

export function confirmJobQuickReply(quoteId: string): object[] {
  return [
    {
      type: "action",
      action: {
        type: "postback",
        label: "✅ ยืนยัน",
        data: `CONFIRM_JOB:${quoteId}`,
        displayText: "ยืนยันงานแล้ว",
      },
    },
    {
      type: "action",
      action: {
        type: "postback",
        label: "❌ ยกเลิก",
        data: `CANCEL_JOB:${quoteId}`,
        displayText: "ยกเลิกงานแล้ว",
      },
    },
  ]
}

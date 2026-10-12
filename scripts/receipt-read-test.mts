import { dispatch } from "@/engines/validation/dispatcher"

/* eslint-disable @typescript-eslint/no-explicit-any */
const list: any = await dispatch("receipt.list", { limit: 3, offset: 0, verification: "all" })
console.log("DEBUG receipt.list:", JSON.stringify(list).slice(0, 300)); console.log("receipt.list ok:", list.ok, "| rows:", list.data?.receipts?.length, "| total:", list.data?.total, "| verified flags:", JSON.stringify(list.data?.receipts?.map((r: any) => r.payment_verified)))

const verified: any = await dispatch("receipt.list", { limit: 5, verification: "verified" })
console.log("DEBUG verified:", JSON.stringify(verified).slice(0, 250)); console.log("receipt.list verified ok:", verified.ok, "| rows:", verified.data?.receipts?.length, "| total:", verified.data?.total, "| all verified:", verified.data?.receipts?.every((r: any) => r.payment_verified))

const firstId: string = list.data?.receipts?.[0]?.id ?? ""
const one: any = await dispatch("receipt.get", { receipt_id: firstId })
console.log("receipt.get ok:", one.ok, "| id:", firstId)

const latest: any = await dispatch("receipt.latest", {})
console.log("receipt.latest ok:", latest.ok, "| verified:", latest.data?.receipt?.payment_verified)

const r2: any = await dispatch("document.receipt", {})
console.log("document.receipt unchanged ok:", r2.ok)
const inv: any = await dispatch("invoice.list", {})
console.log("invoice.list unchanged ok:", inv.ok)


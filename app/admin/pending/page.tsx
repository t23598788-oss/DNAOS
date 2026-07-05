import TransactionPanel from "@/components/transactions/TransactionPanel"

export default function PendingPage() {
  return <TransactionPanel mode="browser" pendingOnly={true} />
}

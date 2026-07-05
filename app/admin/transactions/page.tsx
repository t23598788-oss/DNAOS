import TransactionPanel from "@/components/transactions/TransactionPanel"

export default function TransactionsPage() {
  return <TransactionPanel mode="create" pendingOnly={false} />
}

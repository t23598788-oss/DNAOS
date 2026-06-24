import { supabase } from "@/lib/supabase/queries";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Callback = (event: { table: string; type: string; record: Record<string, unknown> }) => void;

let _channel: RealtimeChannel | null = null;

export function subscribePayments(onEvent: Callback): () => void {
  _channel = supabase()
    .channel("board-payments")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "invoice_payments" },
      (payload) => {
        onEvent({ table: "invoice_payments", type: "INSERT", record: payload.new as Record<string, unknown> });
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "invoice_debts" },
      (payload) => {
        onEvent({ table: "invoice_debts", type: "UPDATE", record: payload.new as Record<string, unknown> });
      }
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "documents" },
      (payload) => {
        onEvent({ table: "documents", type: "INSERT", record: payload.new as Record<string, unknown> });
      }
    )
    .subscribe();

  return () => {
    if (_channel) {
      supabase().removeChannel(_channel);
      _channel = null;
    }
  };
}

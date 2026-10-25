/**
 * Realtime — Supabase Realtime Subscription สำหรับ payments
 */

import { supabase } from "./queries";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type PaymentRow = {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  [key: string]: unknown;
};

type ChangeHandler = (payload: RealtimePostgresChangesPayload<PaymentRow>) => void;

export function subscribePayments(onchange: ChangeHandler): () => void {
  const channel = supabase()
    .channel("payments-realtime")
    .on<PaymentRow>(
      "postgres_changes",
      { event: "*", schema: "public", table: "payments" },
      onchange
    )
    .subscribe();

  return () => {
    supabase().removeChannel(channel);
  };
}

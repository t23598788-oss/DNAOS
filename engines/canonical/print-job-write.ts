import { supabaseAdmin } from "@/services/supabase/queries"

export interface CreatePrintJobInput {
  line_user_id: string
  media_path: string
  document_kind: string
  copies: number
  status: string
}

export interface PrintJobPatch {
  copies?: number
  amount_expected?: number | null
  payment_method?: string | null
  status?: string
  paid_at?: string | null
  amount_paid?: number | null
}

export interface PrintJobRow {
  id: string
  amount_expected?: number | null
  [key: string]: unknown
}

export async function createPrintJob(input: CreatePrintJobInput): Promise<{ job_id: string }> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from("print_jobs")
    .insert({
      line_user_id: input.line_user_id,
      media_path: input.media_path,
      document_kind: input.document_kind,
      copies: input.copies,
      status: input.status,
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`สร้าง print_job ไม่สำเร็จ: ${error?.message ?? "no row"}`)
  return { job_id: String(data.id) }
}

export async function updatePrintJob(jobId: string, patch: PrintJobPatch): Promise<PrintJobRow | null> {
  const db = supabaseAdmin()
  const row: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) row[k] = v
  }
  if (Object.keys(row).length === 0) return null
  const { data, error } = await db
    .from("print_jobs")
    .update(row)
    .eq("id", jobId)
    .select("*")
    .maybeSingle()
  if (error) throw new Error(`อัปเดต print_job ไม่สำเร็จ: ${error.message}`)
  return (data as PrintJobRow | null) ?? null
}

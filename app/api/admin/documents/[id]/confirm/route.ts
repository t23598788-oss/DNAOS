import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/queries"

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const { data, error } = await supabase()
    .from("documents")
    .update({
      status: "saved",
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, document_number, status, confirmed_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ document: data })
}

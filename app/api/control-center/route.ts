import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase/queries";
import { listActions, isLocalMac } from "@/lib/platform/mac/mac-platform";

export async function GET() {
  const webhookBase = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/line-webhook-v2`;

  const [partnersRes, jobsRes, docsRes] = await Promise.all([
    supabase()
      .from("partners")
      .select("id, code, name, partner_type_label, phone")
      .is("deleted_at", null)
      .order("name"),
    supabase()
      .from("jobs")
      .select("id, project_name, job_status, partner_id, contact_name, distance_km, required_quantity, delivered_quantity, created_at, partners(id, code, name, phone)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase()
      .from("documents")
      .select("id, document_number, status, partner_id, net_amount, issue_date")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  if (jobsRes.error) return NextResponse.json({ error: jobsRes.error.message }, { status: 500 });

  const partners = (partnersRes.data ?? []) as any[];
  const jobs = (jobsRes.data ?? []) as any[];
  const docs = (docsRes.data ?? []) as any[];

  const rows = jobs.map((job: any) => {
    const partner = job.partners ?? partners.find((p: any) => p.id === job.partner_id);
    const relatedDoc = docs.find(
      (d: any) => d.partner_id === job.partner_id && d.status !== "cancelled"
    );
    const partnerCode = partner?.code ?? (job.partner_id ? job.partner_id.slice(0, 8) : "default");

    const status: "hold" | "released" | "pending" =
      ["IN_PROGRESS", "DISPATCHED", "LOADING", "EN_ROUTE"].includes(job.job_status)
        ? "hold"
        : ["COMPLETED", "DELIVERED"].includes(job.job_status)
          ? "released"
          : "pending";

    return {
      id: job.id,
      company_name: partner?.name ?? "-",
      company_phone: partner?.phone ?? "",
      webhook_url: `${webhookBase}?ref=${encodeURIComponent(partnerCode)}`,
      client_name: partner?.name ?? job.contact_name ?? "-",
      deposit_amount: Number(relatedDoc?.net_amount ?? 0),
      deposit_doc_number: relatedDoc?.document_number ?? "",
      driver_name: job.contact_name ?? "-",
      distance_km: Number(job.distance_km ?? 0),
      quantity: Number(job.required_quantity ?? 0),
      delivered: Number(job.delivered_quantity ?? 0),
      status,
      project_name: job.project_name ?? "-",
      job_status: job.job_status ?? "-",
      created_at: job.created_at,
    };
  });

  return NextResponse.json({
    rows,
    meta: {
      total_jobs: jobs.length,
      total_partners: partners.length,
      mac_available: isLocalMac(),
      mac_actions: isLocalMac() ? listActions().map((a) => a.name) : [],
    },
  });
}

export async function POST(req: Request) {
  const { job_id, action } = (await req.json()) as {
    job_id: string;
    action: "approve" | "suspend";
  };

  if (!job_id || !["approve", "suspend"].includes(action)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const newStatus = action === "approve" ? "COMPLETED" : "SUSPENDED";

  const { error } = await supabase()
    .from("jobs")
    .update({ job_status: newStatus })
    .eq("id", job_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, job_id, new_status: newStatus });
}

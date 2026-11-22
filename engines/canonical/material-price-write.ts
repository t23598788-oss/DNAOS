/**
 * Central material-price authority (WAVE 2, extended WAVE 3 2026-10-25).
 *
 * ONE module owns the two different things the old code conflated:
 *
 *   recordSellerOffer()   a seller answered a price request through a channel.
 *                         This is EVIDENCE + an OFFER. It NEVER touches the
 *                         published/central price (pit_materials), so a LINE
 *                         message can no longer change what customers are quoted.
 *
 *   applyMaterialPrice()  an AUTHORISED actor changes the central price.
 *                         Authority comes from core/authority/resolve.ts
 *                         (owner or explicit delegation) — never from
 *                         ADMIN_TIER alone, never from a LINE link/name.
 *
 * WAVE 3 ATOMICITY: both commands delegate the write to a Postgres function
 * (see supabase/migrations/20261025000001_material_price_atomic_v1.sql):
 *
 *   record_seller_offer_atomic   request row + audit row, one transaction
 *   apply_material_price_atomic  price row  + audit row, one transaction
 *
 * There is deliberately NO fallback to "write then revert on audit failure":
 * compensation cannot guarantee that a business row never survives without its
 * evidence. While the functions are missing the commands fail closed with
 * PRICE_ATOMIC_RPC_MISSING — a deploy-order error, not a silent downgrade.
 *
 * The TypeScript layer still makes the authority decision (single source:
 * core/authority/resolve.ts) and passes the decision to the function as
 * evidence; the function refuses to persist anything without an ALLOW decision
 * and re-checks ownership for the owner path. Delegation rows are NOT
 * re-validated inside SQL — the service-role boundary is the same trust
 * boundary every other canonical writer uses (documented in the WAVE 3 report).
 *
 * No new table, no provider branch, no second finance/price writer.
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  resolveAuthority,
  authorityEvidence,
  type ActorContext,
  type ScopeGrant,
} from "@/core/authority/resolve";

const round2 = (n: number) => Math.round(n * 100) / 100;

function requirePrice(price: number): number {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) throw new Error(`PRICE_INVALID: ราคาต้องมากกว่าศูนย์ (ได้ ${price})`);
  return round2(p);
}

function requireActor(actor: string | undefined): string {
  const a = actor?.trim() ?? "";
  if (!a) throw new Error("AUDIT_ACTOR_REQUIRED: every canonical write must carry an actor");
  return a;
}

/** Map a Postgres/PostgREST failure from the atomic function to a stable code. */
function rpcFailure(fn: string, error: { code?: string; message?: string; details?: string }): Error {
  const message = error.message ?? "unknown";
  const missing =
    error.code === "PGRST202" ||
    /could not find the function|does not exist|schema cache/i.test(message);
  if (missing) {
    return new Error(
      `PRICE_ATOMIC_RPC_MISSING: ยังไม่ได้ apply migration 20261025000001 (${fn}) — ปฏิเสธการเขียนเพื่อไม่ให้เกิดข้อมูลครึ่งเดียว`,
    );
  }
  if (/price_request_not_found/.test(message)) return new Error("PRICE_REQUEST_NOT_FOUND: ไม่พบคำขอราคานี้");
  if (/price_request_not_pending:?/.test(message)) {
    const status = message.split("price_request_not_pending:")[1] ?? "unknown";
    return new Error(`PRICE_REQUEST_NOT_PENDING: คำขอนี้ถูกตอบ/ปิดไปแล้ว (สถานะ ${status})`);
  }
  if (/price_request_required/.test(message)) return new Error("PRICE_REQUEST_REQUIRED: ต้องระบุคำขอราคาที่ตอบกลับ");
  if (/price_invalid/.test(message)) return new Error("PRICE_INVALID: ราคาต้องมากกว่าศูนย์");
  if (/actor_required/.test(message)) return new Error("AUDIT_ACTOR_REQUIRED: every canonical write must carry an actor");
  if (/pit_not_found/.test(message)) return new Error("PIT_NOT_FOUND: ไม่พบผู้ขาย/บ่อนี้");
  if (/price_forbidden/.test(message)) return new Error(`PRICE_FORBIDDEN:${message.replace(/^.*price_forbidden:?/, "") || "denied"}`);
  return new Error(`PRICE_ATOMIC_RPC_FAILED: ${message}`);
}

// ── dependency seam (default = real Supabase RPC; tests inject a double) ─────

export interface SellerOfferAtomicInput {
  request_id: string;
  price: number;
  actor: string;
  reply_text: string;
  replied_at: string;
  evidence: Record<string, unknown>;
}

export interface SellerOfferAtomicResult {
  already_recorded: boolean;
  price: number;
  audit_id: string | null;
}

export interface ApplyPriceAtomicInput {
  pit_profile_id: string;
  material_type_id: string;
  price: number;
  actor: string;
  actor_profile_id: string;
  authority: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

export interface ApplyPriceAtomicResult {
  changed: boolean;
  price_id: string;
  audit_id: string | null;
  previous_price: number | null;
}

export interface PriceWriteDeps {
  getPit(pitId: string): Promise<{ id: string; owner_profile_id: string | null; organization_id: string | null } | null>;
  recordSellerOfferAtomic(input: SellerOfferAtomicInput): Promise<SellerOfferAtomicResult>;
  applyMaterialPriceAtomic(input: ApplyPriceAtomicInput): Promise<ApplyPriceAtomicResult>;
}

function supabasePriceDeps(): PriceWriteDeps {
  const db = supabaseAdmin();
  return {
    async getPit(pitId) {
      const { data } = await db.from("pit_profiles").select("id, user_id").eq("id", pitId).maybeSingle();
      if (!data) return null;
      const { data: partner, error: partnerError } = await db
        .from("partner_business_profiles")
        .select("company_id")
        .eq("pit_profile_id", pitId)
        .maybeSingle();
      const companyId = !partnerError && partner?.company_id ? String(partner.company_id) : null;
      const { data: company, error: companyError } = companyId
        ? await db.from("companies").select("organization_id").eq("id", companyId).maybeSingle()
        : { data: null, error: null };
      return {
        id: String(data.id),
        owner_profile_id: (data.user_id as string | null) ?? null,
        organization_id: !companyError && company?.organization_id ? String(company.organization_id) : null,
      };
    },
    async recordSellerOfferAtomic(input) {
      const { data, error } = await db.rpc("record_seller_offer_atomic", {
        p_request_id: input.request_id,
        p_price: input.price,
        p_actor: input.actor,
        p_reply_text: input.reply_text,
        p_replied_at: input.replied_at,
        p_evidence: input.evidence,
      });
      if (error) throw rpcFailure("record_seller_offer_atomic", error);
      const row = (data ?? {}) as { already_recorded?: boolean; price?: number; audit_id?: string | null };
      return {
        already_recorded: row.already_recorded === true,
        price: Number(row.price ?? input.price),
        audit_id: row.audit_id ?? null,
      };
    },
    async applyMaterialPriceAtomic(input) {
      const { data, error } = await db.rpc("apply_material_price_atomic", {
        p_pit_profile_id: input.pit_profile_id,
        p_material_type_id: input.material_type_id,
        p_price: input.price,
        p_actor: input.actor,
        p_actor_profile_id: input.actor_profile_id,
        p_authority: input.authority,
        p_evidence: input.evidence,
      });
      if (error) throw rpcFailure("apply_material_price_atomic", error);
      const row = (data ?? {}) as {
        changed?: boolean;
        price_id?: string;
        audit_id?: string | null;
        previous_price?: number | null;
      };
      if (!row.price_id) throw new Error("PRICE_ATOMIC_RPC_FAILED: function returned no price_id");
      return {
        changed: row.changed === true,
        price_id: String(row.price_id),
        audit_id: row.audit_id ?? null,
        previous_price: row.previous_price === undefined || row.previous_price === null ? null : Number(row.previous_price),
      };
    },
  };
}

// ── command 1: seller offer (evidence only) ─────────────────────────────────

export interface SellerOfferInput {
  request_id: string;
  price: number;
  /** the channel message this offer came from (evidence, not authority) */
  source_message_id?: string | null;
  reply_text?: string | null;
  actor: string;
  /** stable key so a redelivered message cannot record the same offer twice */
  idempotency_key?: string | null;
}

export interface SellerOfferResult {
  ok: true;
  request_id: string;
  status: "answered";
  price: number;
  /** ALWAYS false: an offer cannot change the central price by itself */
  price_changed: false;
  already_recorded: boolean;
  audit_id: string | null;
}

export async function recordSellerOffer(
  input: SellerOfferInput,
  deps: PriceWriteDeps = supabasePriceDeps(),
): Promise<SellerOfferResult> {
  const actor = requireActor(input.actor);
  const price = requirePrice(input.price);
  const requestId = input.request_id?.trim();
  if (!requestId) throw new Error("PRICE_REQUEST_REQUIRED: ต้องระบุคำขอราคาที่ตอบกลับ");

  const idempotencyKey = input.idempotency_key?.trim() || `seller_offer:${requestId}:${price}`;
  const replyText = (input.reply_text ?? "").slice(0, 2000);

  const written = await deps.recordSellerOfferAtomic({
    request_id: requestId,
    price,
    actor,
    reply_text: replyText,
    replied_at: new Date().toISOString(),
    evidence: {
      idempotency_key: idempotencyKey,
      source_message_id: input.source_message_id ?? null,
      note: "seller offer only — central price unchanged",
    },
  });

  return {
    ok: true,
    request_id: requestId,
    status: "answered",
    price: written.price,
    price_changed: false,
    already_recorded: written.already_recorded,
    audit_id: written.audit_id,
  };
}

// ── command 2: authorised central price change ──────────────────────────────

export interface ApplyMaterialPriceInput {
  pit_id: string;
  material_type_id: string;
  price: number;
  actor: ActorContext;
  grants?: ScopeGrant[];
  at?: string;
  source?: string | null;
  idempotency_key?: string | null;
}

export interface ApplyMaterialPriceResult {
  changed: boolean;
  price_id: string;
  audit_id: string | null;
  authority: { via: string; reason: string; grant_id: string | null };
}

export async function applyMaterialPrice(
  input: ApplyMaterialPriceInput,
  deps: PriceWriteDeps = supabasePriceDeps(),
): Promise<ApplyMaterialPriceResult> {
  const price = requirePrice(input.price);
  if (!input.actor?.profileId) throw new Error("PRICE_FORBIDDEN:ACTOR_REQUIRED");
  const auditActor = `profile:${input.actor.profileId}`;

  const pit = await deps.getPit(input.pit_id);
  if (!pit) throw new Error("PIT_NOT_FOUND: ไม่พบผู้ขาย/บ่อนี้");

  const decision = resolveAuthority({
    actor: input.actor,
    action: "price.write",
    resource: {
      kind: "pit",
      id: pit.id,
      ownerProfileId: pit.owner_profile_id,
      organizationId: pit.organization_id,
    },
    grants: input.grants ?? [],
    at: input.at,
  });
  if (!decision.allowed) {
    // Fail-closed with the machine reason — never a silent admin bypass.
    throw new Error(`PRICE_FORBIDDEN:${decision.reason}`);
  }

  const idempotencyKey = input.idempotency_key?.trim() || `price_change:${pit.id}:${input.material_type_id}:${price}`;

  const written = await deps.applyMaterialPriceAtomic({
    pit_profile_id: pit.id,
    material_type_id: input.material_type_id,
    price,
    actor: auditActor,
    actor_profile_id: input.actor.profileId,
    authority: authorityEvidence(decision),
    evidence: {
      idempotency_key: idempotencyKey,
      pit_profile_id: pit.id,
      material_type_id: input.material_type_id,
      source: input.source ?? null,
      authority: authorityEvidence(decision),
    },
  });

  return {
    changed: written.changed,
    price_id: written.price_id,
    audit_id: written.audit_id,
    authority: { via: decision.via, reason: decision.reason, grant_id: decision.grantId },
  };
}

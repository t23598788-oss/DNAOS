/**
 * Canonical partner binding write model (Layer 3 identity overlay).
 *
 * The admin LINE-customer surface is a provider-tier route: it may read, but it
 * must not write business identity tables directly (Connect boundary census
 * T1c). This module is the single authority for turning a LINE contact into a
 * partner/customer profile and for (re)binding the channel:
 *
 *   pit_profiles                     the real person/entity record
 *   partner_business_profiles        the business profile hanging off that pit
 *   partner_channel_bindings         channel identity → business profile
 *   identity_business_capabilities   capability overlay (decoupled from chat)
 *
 * Every write is audited through recordCanonicalAudit so the binding keeps its
 * actor + evidence. Failures throw; the route maps them to HTTP responses.
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

export interface CreateCustomerPartnerProfileInput {
  name?: string | null;
  actor: string;
}

export interface CreatedPartnerProfile {
  pit_profile_id: string;
  partner_profile_id: string;
}

export interface BindLinePartnerInput {
  line_user_id: string;
  partner_profile_id?: string | null;
  /** When the LINE contact is still an unidentified lead, create the profile. */
  create?: { name?: string | null } | null;
  actor: string;
}

export interface PartnerBindingResult {
  binding_id: string;
  partner_profile_id: string;
  core_identity_id: string | null;
  created_profile: boolean;
}

const DEFAULT_LEAD_NAME = "ลูกค้าใหม่";

/** Create the pit + business profile pair for a new customer lead. */
export async function createCustomerPartnerProfile(
  input: CreateCustomerPartnerProfileInput,
): Promise<CreatedPartnerProfile> {
  const db = supabaseAdmin();
  const name = (input.name ?? "").trim() || DEFAULT_LEAD_NAME;

  const { data: pit, error: pitErr } = await db
    .from("pit_profiles")
    .insert({
      pit_name: name,
      entity_type: "CUSTOMER",
      owner_type: "INDIVIDUAL",
      is_open: true,
      registered_name: name,
    })
    .select("id")
    .single();
  if (pitErr || !pit) throw new Error(`create pit failed: ${pitErr?.message ?? "unknown"}`);

  const { data: profile, error: profileErr } = await db
    .from("partner_business_profiles")
    .insert({ pit_profile_id: pit.id, readiness_status: "PENDING", business_category: "CUSTOMER" })
    .select("id")
    .single();
  if (profileErr || !profile) {
    throw new Error(`create profile failed: ${profileErr?.message ?? "unknown"}`);
  }

  await recordCanonicalAudit({
    action: "partner.profile_created",
    entity_type: "partner_business_profile",
    entity_id: String(profile.id),
    actor: input.actor,
    new_value: { pit_profile_id: pit.id, name, business_category: "CUSTOMER" },
  });

  return { pit_profile_id: String(pit.id), partner_profile_id: String(profile.id) };
}

/**
 * Bind a LINE channel identity to a partner business profile (creating the
 * profile first when `create` is given), then project the capability overlay.
 */
export async function bindLineChannelToPartner(
  input: BindLinePartnerInput,
): Promise<PartnerBindingResult> {
  const db = supabaseAdmin();
  let partnerProfileId = input.partner_profile_id ?? null;
  let createdProfile = false;

  if (!partnerProfileId && input.create) {
    const created = await createCustomerPartnerProfile({
      name: input.create.name ?? null,
      actor: input.actor,
    });
    partnerProfileId = created.partner_profile_id;
    createdProfile = true;
  }
  if (!partnerProfileId) throw new Error("PARTNER_PROFILE_REQUIRED");

  const { data: existing } = await db
    .from("partner_channel_bindings")
    .select("id")
    .eq("channel_type", "LINE")
    .eq("channel_user_id", input.line_user_id)
    .maybeSingle();

  let bindingId: string;
  if (existing?.id) {
    bindingId = String(existing.id);
    const { error } = await db
      .from("partner_channel_bindings")
      .update({
        partner_business_profile_id: partnerProfileId,
        verified: true,
        confidence: 1,
        source: "MANUAL",
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", bindingId);
    if (error) throw new Error(`bind failed: ${error.message}`);
  } else {
    const { data: created, error } = await db
      .from("partner_channel_bindings")
      .insert({
        channel_type: "LINE",
        channel_user_id: input.line_user_id,
        partner_business_profile_id: partnerProfileId,
        verified: true,
        confidence: 1,
        source: "MANUAL",
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(`bind failed: ${error?.message ?? "unknown"}`);
    bindingId = String(created.id);
  }

  // Layer 3 overlay: capability stays decoupled from the chat binding, and is
  // only projected when the binding really carries a core identity.
  const { data: binding } = await db
    .from("partner_channel_bindings")
    .select("core_identity_id")
    .eq("id", bindingId)
    .maybeSingle();
  const coreIdentityId = binding?.core_identity_id ? String(binding.core_identity_id) : null;

  if (coreIdentityId) {
    const { error: capErr } = await db.from("identity_business_capabilities").upsert(
      {
        core_identity_id: coreIdentityId,
        capability_type: "partner_profile",
        capability_ref_id: partnerProfileId,
        capability_ref_table: "partner_business_profiles",
        metadata: { source: "manual_bind" },
      },
      { onConflict: "core_identity_id,capability_type,capability_ref_id" },
    );
    if (capErr) throw new Error(`capability overlay failed: ${capErr.message}`);
  }

  await recordCanonicalAudit({
    action: "partner.bound",
    entity_type: "partner_channel_binding",
    entity_id: bindingId,
    actor: input.actor,
    new_value: { partner_profile_id: partnerProfileId, verified: true, source: "MANUAL" },
    evidence: { core_identity_id: coreIdentityId, created_profile: createdProfile },
  });

  return {
    binding_id: bindingId,
    partner_profile_id: partnerProfileId,
    core_identity_id: coreIdentityId,
    created_profile: createdProfile,
  };
}

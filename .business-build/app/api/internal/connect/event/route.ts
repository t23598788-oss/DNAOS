/**
 * POST /api/internal/connect/event — DNA OS Connect transport boundary for
 * Business Event commands (capability D, 2026-09-23).
 *
 * This is a GENERIC Connect boundary, not a provider bridge: it carries no
 * provider semantics at all — no LINE parsing, no external-subject resolution,
 * no provider branching, no credential handling — and it never forwards an
 * arbitrary object into the database. The body must be a normalized canonical
 * command, and every field is mapped explicitly into
 * engines/canonical/event-write.ts's typed input.
 *
 *   External Provider → Provider Adapter → Connect normalization
 *     → POST /api/internal/connect/event → Business Event capability
 *     → engines/canonical/event-write.ts → public.business_events
 *
 * Auth: the canonical internal-bridge mechanism already used across this repo
 * (one shared secret per bridge, sent as a header, fail-closed — see
 * LINE_COMMAND_INTERNAL_SECRET / CANONICAL_JOB_INTERNAL_SECRET /
 * DOCUMENT_ARTIFACT_INTERNAL_SECRET). No mechanism is invented here; what IS
 * new is only the secret NAME: CONNECT_INTERNAL_SECRET. Reusing a
 * provider-named secret (e.g. the LINE ones) for this provider-neutral boundary
 * would re-couple the generic boundary to one provider — the exact coupling
 * capability D removes — so a Connect-scoped name is required, and it must be
 * set at release time (the boundary answers 503 until then).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/services/supabase/queries";
import {
  createBusinessEvent,
  transitionBusinessEvent,
  enrichBusinessEvent,
  linkBusinessEventTransaction,
  type CreateBusinessEventInput,
} from "@/engines/canonical/event-write";

/** The closed command vocabulary this boundary accepts — anything else is refused. */
const COMMANDS = [
  "business_event.create",
  "business_event.transition",
  "business_event.enrich",
  "business_event.link_transaction",
] as const;
type Command = (typeof COMMANDS)[number];

interface ConnectEventRequest {
  command?: string;
  actor?: string;
  payload?: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);

export async function POST(req: Request) {
  const secret = process.env.CONNECT_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CONNECT_INTERNAL_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("x-connect-internal-secret") !== secret) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  let body: ConnectEventRequest;
  try {
    body = (await req.json()) as ConnectEventRequest;
  } catch {
    return NextResponse.json({ error: "unparseable JSON body" }, { status: 400 });
  }

  const command = str(body.command);
  const actor = str(body.actor);
  if (!command) return NextResponse.json({ error: "command is required" }, { status: 400 });
  if (!COMMANDS.includes(command as Command)) {
    return NextResponse.json({ error: `unknown command: ${command}` }, { status: 400 });
  }
  if (!actor) return NextResponse.json({ error: "actor is required" }, { status: 400 });

  const p = obj(body.payload) ?? {};
  const db = supabaseAdmin();

  switch (command as Command) {
    case "business_event.create": {
      const eventCode = str(p.event_code);
      const title = str(p.title);
      const eventDate = str(p.event_date);
      const provider = str(p.source_provider);
      if (!eventCode || !title || !eventDate || !provider) {
        return NextResponse.json({ error: "event_code, title, event_date, source_provider are required" }, { status: 400 });
      }
      const input: CreateBusinessEventInput = {
        eventCode,
        title,
        eventDate,
        eventType: str(p.event_type),
        description: str(p.description),
        source: {
          provider,
          externalSubjectId: str(p.source_external_subject_id),
          messageIds: Array.isArray(p.source_message_ids) ? (p.source_message_ids as string[]) : undefined,
        },
        partnerId: str(p.partner_id),
        materialId: str(p.material_id),
        materialText: str(p.material_text),
        quantity: numOrNull(p.quantity),
        quantityUnit: str(p.quantity_unit),
        destination: str(p.destination),
        scheduleText: str(p.schedule_text),
        contactName: str(p.contact_name),
        contactPhone: str(p.contact_phone),
        status: str(p.status) ?? undefined,
        context: obj(p.context),
        confidence: numOrNull(p.confidence),
        metadata: obj(p.metadata) ?? {},
        actor,
      };
      const result = await createBusinessEvent(db, input);
      return NextResponse.json(result, { status: result.ok ? 200 : 422 });
    }

    case "business_event.transition": {
      const to = str(p.status);
      const eventId = str(p.event_id);
      const eventCode = str(p.event_code);
      if (!to || (!eventId && !eventCode)) {
        return NextResponse.json({ error: "status and one of event_id/event_code are required" }, { status: 400 });
      }
      const result = await transitionBusinessEvent(db, {
        eventId: eventId ?? undefined,
        eventCode: eventCode ?? undefined,
        from: str(p.from_status),
        to,
        actor,
        extra: obj(p.fields) ?? {},
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 422 });
    }

    case "business_event.enrich": {
      const eventId = str(p.event_id);
      if (!eventId) return NextResponse.json({ error: "event_id is required" }, { status: 400 });
      const result = await enrichBusinessEvent(db, { eventId, fields: obj(p.fields) ?? {}, actor });
      return NextResponse.json(result, { status: result.ok ? 200 : 422 });
    }

    case "business_event.link_transaction": {
      const eventId = str(p.event_id);
      const transactionId = str(p.transaction_id);
      if (!eventId || !transactionId) {
        return NextResponse.json({ error: "event_id and transaction_id are required" }, { status: 400 });
      }
      const result = await linkBusinessEventTransaction(db, {
        eventId,
        transactionId,
        actor,
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 422 });
    }
  }
}


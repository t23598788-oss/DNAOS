/**
 * Timeline Engine — shared merge primitive
 *
 * Architecture Governance (2026-07-13): app/admin/relationships/feed.ts's
 * buildFeed() and engines/partner/timeline.ts's buildPartnerTimeline() each
 * independently re-implemented "link a document to its originating business
 * event via business_event_id, otherwise treat it as standalone" — same
 * concept, two copies. This is the one shared owner of that linking logic.
 *
 * Deliberately does NOT merge the two callers' output shapes into one type —
 * buildPartnerTimeline's PartnerTimelineEntry[] is a public API contract
 * (engines/validation/dispatcher.ts's "partner.timeline" command, exposed via
 * /api/v1/query) and must not change shape without an explicit versioning
 * decision. Only the duplicated linking algorithm is unified here; each
 * caller keeps building its own output shape from the result.
 */

export function linkDocumentsToEvents<D extends { id: string; business_event_id?: string | null }>(
  documents: D[]
): { documentsByEventId: Map<string, D[]>; standaloneDocuments: D[] } {
  const documentsByEventId = new Map<string, D[]>();
  const standaloneDocuments: D[] = [];
  for (const d of documents) {
    if (d.business_event_id) {
      documentsByEventId.set(d.business_event_id, [...(documentsByEventId.get(d.business_event_id) ?? []), d]);
    } else {
      standaloneDocuments.push(d);
    }
  }
  return { documentsByEventId, standaloneDocuments };
}

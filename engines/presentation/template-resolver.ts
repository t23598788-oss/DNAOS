/**
 * Template Resolution Layer
 *
 * Runtime rendering must not choose ad-hoc components from raw business rows.
 * Every source item resolves here first, then the timeline renders exactly one
 * card for the resolved template key.
 */

export type PresentationTemplateId =
  | "message.timeline-card"
  | "action-result.timeline-card"
  | "business-event.timeline-card"
  | "document-artifact.timeline-card"
  | "receipt.timeline-card";

export interface PresentationTemplate {
  template_id: PresentationTemplateId;
  template_key: string;
}

interface TemplateResolutionInput {
  source_kind: "message" | "action_log" | "business_event" | "document" | "receipt";
  source_id: string;
  business_event_id?: string | null;
}

export function resolvePresentationTemplate(input: TemplateResolutionInput): PresentationTemplate {
  if (input.business_event_id) {
    return {
      template_id: "business-event.timeline-card",
      template_key: `business-event:${input.business_event_id}`,
    };
  }

  if (input.source_kind === "business_event") {
    return {
      template_id: "business-event.timeline-card",
      template_key: `business-event:${input.source_id}`,
    };
  }

  if (input.source_kind === "document") {
    return {
      template_id: "document-artifact.timeline-card",
      template_key: `document:${input.source_id}`,
    };
  }

  if (input.source_kind === "receipt") {
    return {
      template_id: "receipt.timeline-card",
      template_key: `receipt:${input.source_id}`,
    };
  }

  if (input.source_kind === "action_log") {
    return {
      template_id: "action-result.timeline-card",
      template_key: `action-log:${input.source_id}`,
    };
  }

  return {
    template_id: "message.timeline-card",
    template_key: `message:${input.source_id}`,
  };
}

export function uniqueResolvedTemplates<T extends PresentationTemplate>(items: T[]): T[] {
  const byTemplateKey = new Map<string, T>();
  for (const item of items) {
    if (!byTemplateKey.has(item.template_key)) {
      byTemplateKey.set(item.template_key, item);
    }
  }
  return Array.from(byTemplateKey.values());
}

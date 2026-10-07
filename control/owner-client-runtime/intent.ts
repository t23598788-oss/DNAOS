/**
 * OWNER_INTENT_REQUEST_V1 — structured request, never authority.
 */

import { randomUUID } from "node:crypto";
import { getEverydayAction } from "../local-resource-access/contract";
import type { OwnerIntentRequestV1 } from "./types";

export function normalizeOwnerIntent(input: {
  readonly client_id: string;
  readonly text: string;
  readonly resource_id?: string;
  readonly destination_id?: string;
}): OwnerIntentRequestV1 {
  const text = input.text.toLowerCase();
  let canonical_action = "SEARCH";
  let requested_output = "minimized_matches";
  if (/ส่ง|email|send|share/.test(text)) {
    canonical_action = "SEND";
    requested_output = "preview";
  } else if (/copy|คัดลอก|ย้าย|move/.test(text)) {
    canonical_action = /move|ย้าย/.test(text) ? "MOVE" : "COPY";
    requested_output = "preview";
  } else if (/ตรวจโค้ด|review|diff|git/.test(text)) {
    canonical_action = "COMPARE";
    requested_output = "local_diff_and_tests";
  } else if (/หา|search|find|เอกสาร/.test(text)) {
    canonical_action = "SEARCH";
  }
  const everyday = getEverydayAction(canonical_action);
  const approval = everyday?.owner_approval_requirement === "OWNER_APPROVAL_REQUIRED"
    || ["SEND", "SHARE", "COPY", "MOVE", "DELETE"].includes(canonical_action)
    ? "OWNER_APPROVAL_REQUIRED"
    : "NONE";
  return {
    schema: "OWNER_INTENT_REQUEST_V1",
    request_id: `intent-${randomUUID()}`,
    client_id: input.client_id,
    goal: input.text,
    canonical_action,
    target_resource_refs: input.resource_id ? [input.resource_id] : [],
    destination_refs: input.destination_id ? [input.destination_id] : [],
    constraints: /เดือนนี้|this month/.test(text) ? { date: "current_month" } : {},
    requested_output,
    approval_expectation: approval,
    is_authority: false,
  };
}

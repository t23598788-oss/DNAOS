/**
 * Shared actor plumbing: every actor observes the DB before and after its own
 * real HTTP call, so the timeline can state what the request actually changed.
 */
import { diff, snapshot, type Snapshot } from "../db";
import type { HttpResult } from "../http";

export interface ActorRequest {
  method: string;
  path: string;
  /** true only when the signature/token was really computed from a local secret */
  signed: boolean;
  signatureNote: string;
  bodyPreview?: string;
}

export interface ActorResult {
  actor: string;
  action: string;
  request: ActorRequest;
  response: HttpResult;
  dbChanged: string[];
  before: Snapshot;
  after: Snapshot;
}

export async function act(
  actor: string,
  action: string,
  request: ActorRequest,
  watched: string[],
  call: () => Promise<HttpResult>,
): Promise<ActorResult> {
  const before = await snapshot(watched);
  const response = await call();
  const after = await snapshot(watched);
  return { actor, action, request, response, dbChanged: diff(before, after), before, after };
}

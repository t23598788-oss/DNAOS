/**
 * Canonical SemanticId parser/validator.
 * Grammar: <kind>://<namespace>/<stable-name>[@<version>]
 * Forbidden inside identity: abs paths, line numbers, hostnames, usernames, SHAs.
 */

import type { ParsedSemanticId, SemanticId, SemanticKind } from "./types";

const KINDS = new Set<SemanticKind>([
  "repository",
  "capability",
  "contract",
  "policy",
  "adapter",
  "connection",
  "credential",
  "endpoint",
  "executor",
  "test",
  "evidence",
]);

/** Detects attributes that must never be encoded in semantic identity. */
const FORBIDDEN_IN_ID = /(?:\/Users\/|\/home\/|\\\\|[A-Za-z]:\\|@[0-9a-f]{7,40}\b|:\d{2,}|\.local\b|\.railway\.app\b)/i;

export function isSemanticKind(value: string): value is SemanticKind {
  return KINDS.has(value as SemanticKind);
}

export function parseSemanticId(raw: string): ParsedSemanticId | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "empty" };
  }
  const id = raw.trim();
  if (FORBIDDEN_IN_ID.test(id)) {
    return { ok: false, reason: "forbidden_identity_attribute" };
  }
  const m = /^([a-z]+):\/\/([^/@]+)\/([^@]+)(?:@([A-Za-z0-9][A-Za-z0-9._-]*))?$/.exec(id);
  if (!m) {
    return { ok: false, reason: "grammar" };
  }
  const scheme = m[1]!;
  if (!isSemanticKind(scheme)) {
    return { ok: false, reason: "unknown_kind" };
  }
  const namespace = m[2]!;
  const name = m[3]!;
  const version = m[4] ?? null;
  if (!namespace || !name || /\s/.test(namespace) || /\s/.test(name)) {
    return { ok: false, reason: "empty_parts" };
  }
  const canonical = version
    ? `${scheme}://${namespace}/${name}@${version}`
    : `${scheme}://${namespace}/${name}`;
  return { scheme, namespace, name, version, canonical };
}

export function assertSemanticId(raw: string): SemanticId {
  const parsed = parseSemanticId(raw);
  if ("ok" in parsed && parsed.ok === false) {
    throw new Error(`INVALID_SEMANTIC_ID:${parsed.reason}:${raw}`);
  }
  return (parsed as ParsedSemanticId).canonical;
}

export function canonicalizeSemanticId(raw: string): SemanticId | null {
  const parsed = parseSemanticId(raw);
  if ("ok" in parsed && parsed.ok === false) return null;
  return (parsed as ParsedSemanticId).canonical;
}

export function kindOf(id: SemanticId): SemanticKind | null {
  const parsed = parseSemanticId(id);
  if ("ok" in parsed && parsed.ok === false) return null;
  return (parsed as ParsedSemanticId).scheme;
}

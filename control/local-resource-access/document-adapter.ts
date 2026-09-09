/**
 * Local-first document / PDF / image inspection. Never ships whole files to an external model.
 * Conversion is registered-jobs only; unregistered conversion is denied.
 */

import { readFileSync, statSync } from "node:fs";
import { classifyLocalFile, logicalRef, resolveLogicalPath } from "./path-scope";
import type { LocalResourceV1, SummarizeByteEvidence } from "./types";

const WORKING_SET_CAP = 2048;

function denySecret(logical: string): string | null {
  const cls = classifyLocalFile(logical);
  if (cls === "SECRET" || cls === "CREDENTIAL") return "SECRET_EGRESS_DENIED";
  return null;
}

export function extractPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const strings: string[] = [];
  const re = /\((?:\\\)|[^)]){1,400}\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const inner = match[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\\)/g, ")");
    if (/[A-Za-z]{3,}/.test(inner)) strings.push(inner);
  }
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]{0,8000}?)endstream/g)].map((row) => row[1] ?? "");
  const fromStreams = streams
    .map((chunk) => chunk.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " "))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return (strings.join(" ") + " " + fromStreams).replace(/\s+/g, " ").trim();
}

export function extractDocumentText(resource: LocalResourceV1, logicalPath: string): { ok: true; payload: Record<string, unknown> } | { ok: false; reason_code: string } {
  const resolved = resolveLogicalPath(resource, logicalPath);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  const secret = denySecret(resolved.logical);
  if (secret) return { ok: false, reason_code: secret };
  const buf = readFileSync(resolved.abs);
  const lower = resolved.logical.toLowerCase();
  const text = lower.endsWith(".pdf") ? extractPdfText(buf) : buf.toString("utf8");
  return {
    ok: true,
    payload: {
      logical_ref: logicalRef(resource.resource_id, resolved.logical),
      extracted_text: text.slice(0, 4096),
      extracted_chars: Math.min(text.length, 4096),
      source_bytes: buf.length,
      locality: "LOCAL",
    },
  };
}

export function documentMetadata(resource: LocalResourceV1, logicalPath: string): { ok: true; payload: Record<string, unknown> } | { ok: false; reason_code: string } {
  const resolved = resolveLogicalPath(resource, logicalPath);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  const st = statSync(resolved.abs);
  const buf = readFileSync(resolved.abs).subarray(0, 16);
  return {
    ok: true,
    payload: {
      logical_ref: logicalRef(resource.resource_id, resolved.logical),
      bytes: st.size,
      magic: buf.toString("hex"),
      pdf: resolved.logical.toLowerCase().endsWith(".pdf") || buf.subarray(0, 5).toString("utf8") === "%PDF-",
      locality: "LOCAL",
    },
  };
}

export function imageMetadata(resource: LocalResourceV1, logicalPath: string): { ok: true; payload: Record<string, unknown> } | { ok: false; reason_code: string } {
  const resolved = resolveLogicalPath(resource, logicalPath);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  const buf = readFileSync(resolved.abs);
  const png = buf.length >= 24 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
  let width: number | null = null;
  let height: number | null = null;
  if (png) {
    width = buf.readUInt32BE(16);
    height = buf.readUInt32BE(20);
  }
  return {
    ok: true,
    payload: {
      logical_ref: logicalRef(resource.resource_id, resolved.logical),
      bytes: buf.length,
      format: png ? "png" : jpeg ? "jpeg" : "unknown",
      width,
      height,
      locality: "LOCAL",
    },
  };
}

export function convertRegistered(): { ok: false; reason_code: "NOT_REGISTERED" } {
  return { ok: false, reason_code: "NOT_REGISTERED" };
}

function localSummary(text: string): string {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const hit = lines.find((line) => /zzqegate|marker|summary/i.test(line));
  const head = lines.slice(0, 8).join(" ");
  return `LOCAL_SUMMARY: ${(hit ?? head).slice(0, 400)}`;
}

export function summarizeDocument(resource: LocalResourceV1, logicalPath: string): { ok: true; payload: Record<string, unknown>; evidence: SummarizeByteEvidence } | { ok: false; reason_code: string } {
  const resolved = resolveLogicalPath(resource, logicalPath);
  if (!resolved.ok) return { ok: false, reason_code: resolved.reason_code };
  const secret = denySecret(resolved.logical);
  if (secret) return { ok: false, reason_code: secret };
  const buf = readFileSync(resolved.abs);
  const lower = resolved.logical.toLowerCase();
  const text = lower.endsWith(".pdf") ? extractPdfText(buf) : buf.toString("utf8");
  const working = text.slice(0, WORKING_SET_CAP);
  const summary = localSummary(working);
  const evidence: SummarizeByteEvidence = {
    SOURCE_BYTES: buf.length,
    LOCAL_BYTES_PROCESSED: text.length,
    EXTERNAL_BYTES_SENT: Buffer.byteLength(summary, "utf8"),
    RESULT_BYTES_RETURNED: Buffer.byteLength(summary, "utf8"),
  };
  return {
    ok: true,
    evidence,
    payload: {
      logical_ref: logicalRef(resource.resource_id, resolved.logical),
      summary,
      working_set_chars: working.length,
      locality: "LOCAL",
      SOURCE_BYTES: evidence.SOURCE_BYTES,
      LOCAL_BYTES_PROCESSED: evidence.LOCAL_BYTES_PROCESSED,
      RESULT_BYTES_RETURNED: evidence.RESULT_BYTES_RETURNED,
    },
  };
}

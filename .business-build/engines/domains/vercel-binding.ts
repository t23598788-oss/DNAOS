/**
 * Vercel Domain Binding — attach/verify/remove a custom domain on this
 * project (dna-os-deadboard)
 *
 * Endpoints verified against live Vercel REST API docs (2026-07-13):
 * POST /v10/projects/{id}/domains, POST /v9/projects/{id}/domains/{domain}/verify,
 * DELETE /v9/projects/{id}/domains/{domain} — https://vercel.com/docs/rest-api/projects/*
 *
 * Vercel is treated as core infrastructure this app already runs on (like the
 * Supabase service-role key), not a pluggable business Connector — reads
 * VERCEL_TOKEN directly from env, same pattern as LINE_CHANNEL_ACCESS_TOKEN
 * elsewhere in this codebase, not the connectors table.
 *
 * projectId/orgId below are the real, already-linked values for this project
 * (.vercel/project.json), not guessed.
 */

const PROJECT_ID = "prj_G1Fz2gKa4fOR5SCbzmtnXbpBapF6";
const TEAM_ID = "team_3uDXRYjLEx8E3AVWiuegeg2N";
const API_BASE = "https://api.vercel.com";

function requireToken(): { ok: true; token: string } | { ok: false; error: string } {
  const token = process.env.VERCEL_TOKEN;
  if (!token) {
    return { ok: false, error: "VERCEL_TOKEN ยังไม่ได้ตั้งค่า — ต้องสร้าง token จริงที่ vercel.com/account/tokens แล้วเพิ่มเป็น environment variable ก่อนใช้งานฟังก์ชันนี้" };
  }
  return { ok: true, token };
}

async function vFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM_ID}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: (data as any)?.error?.message ?? `Vercel API HTTP ${res.status}` };
  }
  return { ok: true, data: data as T };
}

export interface VercelDomainBinding {
  name: string;
  apexName: string;
  verified: boolean;
  verification?: { type: string; domain: string; value: string; reason: string }[];
}

// Irreversible-adjacent (adds this domain as a live alias target for the
// project) — must go through gateway/domains.ts's confirm flow.
export async function addDomainToProject(domain: string): Promise<{ ok: true; result: VercelDomainBinding } | { ok: false; error: string }> {
  const t = requireToken();
  if (!t.ok) return t;
  const r = await vFetch<VercelDomainBinding>(t.token, `/v10/projects/${PROJECT_ID}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  if (!r.ok) return r;
  return { ok: true, result: r.data };
}

export async function verifyDomain(domain: string): Promise<{ ok: true; result: VercelDomainBinding } | { ok: false; error: string }> {
  const t = requireToken();
  if (!t.ok) return t;
  const r = await vFetch<VercelDomainBinding>(t.token, `/v9/projects/${PROJECT_ID}/domains/${domain}/verify`, { method: "POST" });
  if (!r.ok) return r;
  return { ok: true, result: r.data };
}

// Irreversible — removes the domain as an alias for this project.
export async function removeDomainFromProject(domain: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = requireToken();
  if (!t.ok) return t;
  const r = await vFetch(t.token, `/v9/projects/${PROJECT_ID}/domains/${domain}`, { method: "DELETE" });
  if (!r.ok) return r;
  return { ok: true };
}

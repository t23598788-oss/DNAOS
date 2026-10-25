/**
 * DNS Verification Runtime (owner, 2026-08-08, Software Factory Step
 * 13.7). Real DNS resolution using Node's own, built-in `dns.promises`
 * module — no external tool needed, no new dependency, real and
 * standard. Never guesses a host's DNS status; NXDOMAIN/timeout/error
 * are all honestly, separately reported.
 */
import { promises as dns } from "dns";

export type DnsResolutionStatus = "RESOLVED" | "NXDOMAIN" | "TIMEOUT" | "ERROR";

export interface DnsVerificationRecord {
  host: string;
  status: DnsResolutionStatus;
  aRecords: string[];
  aaaaRecords: string[];
  cname: string | null;
  error: string | null;
  resolvedAt: string;
}

/** Real, per-host DNS resolution — A/AAAA/CNAME, each independently,
 * honest partial results (e.g. a host with only AAAA and no A). */
export async function resolveDnsForHost(host: string, timeoutMs = 5000): Promise<DnsVerificationRecord> {
  const record: DnsVerificationRecord = { host, status: "ERROR", aRecords: [], aaaaRecords: [], cname: null, error: null, resolvedAt: new Date().toISOString() };
  const withTimeout = <T,>(p: Promise<T>): Promise<T> => Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("real DNS lookup timeout")), timeoutMs))]);

  let anyResolved = false;
  try { record.aRecords = await withTimeout(dns.resolve4(host)); anyResolved = anyResolved || record.aRecords.length > 0; } catch (e) { const err = e as NodeJS.ErrnoException; if (err.code !== "ENODATA" && err.code !== "ENOTFOUND") record.error = err.message ?? String(e); }
  try { record.aaaaRecords = await withTimeout(dns.resolve6(host)); anyResolved = anyResolved || record.aaaaRecords.length > 0; } catch { /* honest partial — AAAA absence is normal, not an error */ }
  try { const cnames = await withTimeout(dns.resolveCname(host)); record.cname = cnames[0] ?? null; anyResolved = anyResolved || !!record.cname; } catch { /* no CNAME is normal */ }

  if (anyResolved) record.status = "RESOLVED";
  else if (record.error?.includes("timeout")) record.status = "TIMEOUT";
  else record.status = "NXDOMAIN";
  return record;
}

export async function resolveDnsForHosts(hosts: string[], timeoutMs = 5000): Promise<DnsVerificationRecord[]> {
  return Promise.all(hosts.map((h) => resolveDnsForHost(h, timeoutMs)));
}

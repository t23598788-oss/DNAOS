/**
 * Phase 4 — TLS TRUST LAYER (mutual TLS over the private network, 2026-10-16).
 *
 * Same discipline as every other spawn in dna-os-compute: fixed executable
 * (openssl), fixed argv, short timeout, NO shell strings, and FAIL-CLOSED —
 * if the openssl toolchain is unavailable the caller gets an honest error
 * and the daemon STAYS OFF (it never silently downgrades to token-only
 * once TLS is requested). No second credential store: keys live ONLY in
 * the runtime-local config directory; nothing here ever touches a
 * Production credential, the Business plane, or Supabase.
 *
 * Identity model
 *  - ONE long-lived private CA, generated on the daemon host at first boot.
 *  - daemon = leaf "server" cert whose SANs cover loopback AND the LAN name
 *    the Business server will dial (issued by the same CA).
 *  - each Business server = leaf "client" cert (CN = its friendly name,
 *    e.g. "dnaos-macbook"); the daemon keeps a SHA-256 fingerprint
 *    allowlist — a client certificate that is NOT on the list completes
 *    the TLS handshake (proves possession of a CA-signed key) but is then
 *    denied at the HTTP layer (same 401 as a wrong bearer token).
 *  - rotation = issue a new leaf with the SAME CN (365d→ short 30d
 *    validity) and swap the fingerprint allowlist: old leaf keeps
 *    handshake-valid until it expires but loses authority immediately.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { randomBytes } from "crypto";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

export class TrustError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface LeafCertFiles { certPemPath: string; keyPemPath: string; }

export interface CaBundle { dir: string; caCertPemPath: string; caKeyPemPath: string; }

const OPENSSL = "openssl";

async function runOpenSSL(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(OPENSSL, args, { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const e = error as { code?: unknown; stderr?: string; message: string };
    if ((e.code as unknown) === "ENOENT") {
      throw new TrustError("TRUST_TOOLCHAIN_UNAVAILABLE", "openssl is not on PATH — install OpenSSL 3.x (Git for Windows on Windows, brew openssl on macOS) and re-run; daemon stays OFF until trust is established");
    }
    throw new TrustError("TRUST_GEN_FAILED", `openssl ${args[0] ?? ""} failed: ${e.stderr?.trim() || e.message}`);
  }
}

function nowStamp(): string { return new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14); }

/* ── CA ──────────────────────────────────────────────────────────────────── */

/** Create (or verify existing) CA at trustDir. Returns bundle; isCreator
 * tells the caller whether this run generated the key (bootstrap step). */
export async function ensureCa(trustDir: string): Promise<{ bundle: CaBundle; created: boolean }> {
  await fs.mkdir(trustDir, { recursive: true });
  const caCert = path.join(trustDir, "ca-cert.pem");
  const caKey = path.join(trustDir, "ca-key.pem");
  const cn = "DNA OS Compute Root CA";
  const subj = `/CN=${cn}/O=DNA OS/OU=Private Network/serialNumber=${randomBytes(4).toString("hex")}`;
  try {
    await fs.access(caCert);
    return { bundle: { dir: trustDir, caCertPemPath: caCert, caKeyPemPath: caKey }, created: false };
  } catch { /* first boot */ }
  await runOpenSSL(["req", "-x509", "-newkey", "rsa:4096", "-nodes", "-keyout", caKey, "-out", caCert, "-days", "3650", "-subj", subj]);
  return { bundle: { dir: trustDir, caCertPemPath: caCert, caKeyPemPath: caKey }, created: true };
}

/* ── Leaves ──────────────────────────────────────────────────────────────── */

/** Issue a CA-signed leaf (server or client role) with fixed argv only. */
export async function issueLeaf(
  ca: CaBundle,
  opts: { cn: string; role: "server" | "client"; sansDns?: string[]; sansIp?: string[]; outDir?: string; days?: number },
): Promise<LeafCertFiles & { fpr: string }> {
  const { cn, role, sansDns = [], sansIp = [], days = 30, outDir = ca.dir } = opts;
  const roleSlug = role === "server" ? "server" : "client";
  const base = path.join(outDir, `${roleSlug}-${cn.replace(/[^A-Za-z0-9._-]/g, "_")}`);
  await fs.mkdir(path.dirname(base), { recursive: true });
  const keyPem = `${base}.key.pem`;
  const certPem = `${base}.cert.pem`;
  const csrPem = `${base}.csr.pem`;
  const extFile = `${base}.ext.cnf`;
  const subj = `/CN=${cn}/O=DNA OS/OU=${role === "server" ? "Compute Server" : "Business Client"}`;
  const sans = [
    ...sansDns.map((d) => `DNS:${d}`),
    ...sansIp.map((ip) => `IP:${ip}`),
  ].join(",");
  const ext = role === "server"
    ? `subjectAltName=${sans || "DNS:localhost"}\nextendedKeyUsage=serverAuth\n`
    : `extendedKeyUsage=clientAuth\n`;
  await fs.writeFile(extFile, ext, "utf-8");
  try {
    await runOpenSSL(["req", "-newkey", "rsa:3072", "-nodes", "-keyout", keyPem, "-out", csrPem, "-subj", subj]);
    await runOpenSSL(["x509", "-req", "-in", csrPem, "-CA", ca.caCertPemPath, "-CAkey", ca.caKeyPemPath, "-CAcreateserial", `-days`, String(days), "-extfile", extFile, "-out", certPem]);
  } finally {
    await fs.rm(extFile, { force: true }).catch(() => {});
    await fs.rm(csrPem, { force: true }).catch(() => {});
  }
  const fpr = await certFingerprint(certPem);
  return { certPemPath: certPem, keyPemPath: keyPem, fpr };
}

/** Server leaf at first boot: SANs = loopback + caller-declared LAN names. */
export async function ensureServerLeaf(ca: CaBundle, sansDns: string[], sansIp: string[]): Promise<LeafCertFiles & { fpr: string; created: boolean }> {
  const existing = path.join(ca.dir, "server-daemon.cert.pem");
  try {
    await fs.access(existing);
    return { certPemPath: existing, keyPemPath: path.join(ca.dir, "server-daemon.key.pem"), fpr: await certFingerprint(existing), created: false };
  } catch { /* generate */ }    const leaf = await issueLeaf(ca, { cn: "dna-os-daemon", role: "server", sansDns: [...sansDns, "localhost"], sansIp: [...sansIp, "127.0.0.1"], days: 180, outDir: ca.dir });
  // rename to stable names
  const certStable = path.join(ca.dir, "server-daemon.cert.pem");
  const keyStable = path.join(ca.dir, "server-daemon.key.pem");
  await fs.rename(leaf.certPemPath, certStable);
  await fs.rename(leaf.keyPemPath, keyStable);
  return { certPemPath: certStable, keyPemPath: keyStable, fpr: leaf.fpr, created: true };
}

/* ── Fingerprints & rotation ─────────────────────────────────────────────── */

/** SHA-256 fingerprint from a PEM file (what the daemon allowlist stores). */
export async function certFingerprint(certPemPath: string): Promise<string> {
  const out = await runOpenSSL(["x509", "-in", certPemPath, "-noout", "-fingerprint", "-sha256"]);
  const raw = /sha256 Fingerprint=([0-9A-F:]+)/i.exec(out)?.[1] ?? "";
  return raw.replace(/:/g, "").toLowerCase(); // hex, lowercase — stable format
}

export function fingerprintOfPemText(pem: string): string {
  const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
  return sha256(pem.replace(/\r/g, ""));
}

/** Rotation helper for SECURITY: produce a NEW client leaf with the same
 * CN under a SEPARATE subdirectory (never overwrites the previous leaf —
 * an old client's files must keep existing for audit/forensics); caller
 * swaps the daemon's fingerprint allowlist explicitly. */
export async function rotateClientLeaf(ca: CaBundle, cn: string): Promise<LeafCertFiles & { fpr: string }> {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const outDir = path.join(ca.dir, "rotations", `${cn.replace(/[^A-Za-z0-9._-]/g, "_")}-${stamp}`);
  return issueLeaf(ca, { cn, role: "client", days: 30, outDir });
}



/**
 * /admin/settings — Settings tool's real page (Integrated Development
 * Workspace shell, owner, 2026-08-05). Three real sources, no page existed
 * for any of them before this:
 *   - registry/permissions.json — roles + role_tiers (already the single
 *     source of truth core/auth/requireAuth.ts reads; this page only reads
 *     it too, never a second copy).
 *   - config/system-links.ts — SYSTEM_LINKS groups (Supabase/Vercel/etc
 *     dashboard shortcuts already used elsewhere in the app).
 *   - .env.local.example — variable NAMES only, cross-checked against
 *     process.env to show configured/missing per name. Values are never
 *     read or rendered — this is a presence check, not a secrets viewer.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import { SYSTEM_LINKS } from "@/config/system-links";
import permissions from "@/registry/permissions.json";
import { ConnectionsCredentialsBoard } from "@/components/admin/ConnectionsCredentialsBoard";

function readEnvVarNames(): string[] {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local.example"), "utf8");
    const names = [...raw.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    return [...new Set(names)].sort();
  } catch {
    return [];
  }
}

export default async function SettingsPage() {
  await requireAuthPage("/admin/settings", ADMIN_TIER);
  const envVarNames = readEnvVarNames();

  return (
    <div style={{ padding: 24, fontFamily: "var(--font-ui)", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>Settings</h1>

      <section style={{ marginBottom: 32 }} id="connections-credentials">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Connections &amp; Credentials</h2>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
          Schema-driven provider cards — same registry &amp; data source as line-customers → PROVIDER CONTROL →
          API &amp; Credentials Management (one settings system, rendered from provider_credential_requirements).
          ค่ารหัสจริงอยู่ที่ Connect credential authority — หน้านี้เห็นเฉพาะสถานะ/metadata
        </p>
        <ConnectionsCredentialsBoard />
      </section>

      <section style={{ marginBottom: 32 }} id="system-references">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>System references</h2>
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Login, identity &amp; session</div>
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 8px" }}>
            เส้นทางจากหน้าเข้าสู่ระบบไปยังบริการยืนยันตัวตน ซอร์สโค้ด และประวัติรุ่นที่บันทึกในฐานข้อมูล
          </p>
          <a href="https://dnaos.dev/system-map#login-identity" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#1e6fa8" }}>
            Open login &amp; identity reference
          </a>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Environment Variables ({envVarNames.length})</h2>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
          Presence only — values are never read or shown here.
        </p>
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 8 }}>
          {envVarNames.map((name) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 13, fontFamily: "var(--font-ui)" }}>
              <span>{name}</span>
              <span style={{ color: process.env[name] ? "#1e9e5a" : "#c9312b" }}>
                {process.env[name] ? "configured" : "missing"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Roles &amp; Permissions</h2>
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 8 }}>
          {(permissions as any).roles.map((r: any) => (
            <div key={r.id} style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
              <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600 }}>{r.id}</span>
              <span style={{ color: "#888", marginLeft: 8 }}>{r.th}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>System Links</h2>
        <div style={{ display: "grid", gap: 16 }}>
          {SYSTEM_LINKS.map((group) => (
            <div key={group.id} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{group.title}</div>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>{group.account}</div>
              {group.items.map((item) => (
                <a key={item.url} href={item.url} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 12, color: "#1e6fa8", marginBottom: 4 }}>
                  {item.label}
                </a>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

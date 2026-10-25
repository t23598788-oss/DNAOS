import { NextResponse } from "next/server";

/**
 * LIVE PROVIDER AVAILABILITY (owner, 2026-10-18)
 *
 * The login UI must never show a provider that is not actually enabled in
 * Supabase. This route reads the public `/auth/v1/settings` response with the
 * same anon key the browser already uses and returns ONLY booleans for the
 * providers this system supports.
 *
 * - read-only: no session, no user data, no secrets are returned
 * - no auth authority: choosing a provider still resolves identity/role/tenant
 *   through the existing profiles + org_members authorities after sign-in
 * - fail closed: if settings cannot be read, no provider is advertised and the
 *   email OTP path (the primary flow) remains available
 */

const SUPPORTED_PROVIDERS = ["google", "apple", "azure", "github"] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

interface SupabaseAuthSettings {
  external?: Record<string, boolean>;
}

// Provider config changes rarely; five minutes keeps the button set accurate
// without a Dashboard round trip on every login page view.
export const revalidate = 300;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json({ providers: [], email: false });
  }

  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      next: { revalidate },
    });
    if (!response.ok) {
      return NextResponse.json({ providers: [], email: false });
    }
    const settings = (await response.json()) as SupabaseAuthSettings;
    const providers = SUPPORTED_PROVIDERS.filter(
      (provider): provider is SupportedProvider => settings.external?.[provider] === true,
    );
    return NextResponse.json({
      providers,
      // `external.email` is the Supabase email provider flag; default false
      // when absent so the UI can explain that email OTP is unavailable.
      email: settings.external?.email === true,
    });
  } catch {
    return NextResponse.json({ providers: [], email: false });
  }
}

import { SignJWT, jwtVerify } from "jose";

const prefix = "dna_sandbox_";
const audience = "dnaos-local-sandbox";
const lifetimeSeconds = 30 * 60;

export async function issueSandboxToken(accountId: string, key: Uint8Array) {
  const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const signed = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dnaos")
    .setAudience(audience)
    .setSubject(accountId)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key);
  return { token: prefix + signed, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export async function verifySandboxToken(token: string, key: Uint8Array) {
  if (!token.startsWith(prefix) || token.length > 2048) return null;
  try {
    const { payload } = await jwtVerify(token.slice(prefix.length), key, {
      algorithms: ["HS256"],
      issuer: "dnaos",
      audience,
      requiredClaims: ["sub", "exp", "iat"],
      maxTokenAge: lifetimeSeconds,
    });
    return payload.sub && payload.exp ? { expiresAt: new Date(payload.exp * 1000).toISOString() } : null;
  } catch {
    return null;
  }
}

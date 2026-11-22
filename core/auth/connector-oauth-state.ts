import { randomBytes, timingSafeEqual } from "node:crypto";

const STATE_BYTES = 32;

export function createConnectorOAuthState(userId: string): { state: string; cookieValue: string } {
  const state = randomBytes(STATE_BYTES).toString("base64url");
  return { state, cookieValue: `${userId}.${state}` };
}

export function connectorOAuthCookieName(connectorId: string): string {
  return `dnaos_connector_oauth_${connectorId}`;
}

export function verifyConnectorOAuthState(input: {
  userId: string;
  state: string | null;
  cookieValue: string | undefined;
}): boolean {
  if (!input.state || !input.cookieValue) return false;
  const expected = Buffer.from(`${input.userId}.${input.state}`);
  const actual = Buffer.from(input.cookieValue);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

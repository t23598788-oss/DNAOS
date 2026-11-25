import { createHmac } from "node:crypto";
import worker from "../workers/meta-webhook/index";

const env = {
  META_APP_SECRET: "test-app-secret",
  META_VERIFY_TOKEN: "test-verify-token",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};

function assert(name: string, condition: boolean): void {
  if (!condition) throw new Error(`FAIL ${name}`);
  console.log(`PASS ${name}`);
}

const get = async (query: string, overrides = {}) => worker.fetch(
  new Request(`https://dnaos.dev/api/gateway/observe/meta${query}`),
  { ...env, ...overrides },
);

async function main(): Promise<void> {
const validChallenge = await get("?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=probe");
assert("valid Meta challenge is echoed as plain text", validChallenge.status === 200 && await validChallenge.text() === "probe");
assert("missing verify token is rejected", (await get("?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=probe", { META_VERIFY_TOKEN: "" })).status === 503);
assert("wrong verify token is rejected", (await get("?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=probe")).status === 403);

const pathMismatch = await worker.fetch(new Request("https://dnaos.dev/not-the-callback"), env);
assert("unmatched route path is not handled", pathMismatch.status === 404);
const wrongMethod = await worker.fetch(new Request("https://dnaos.dev/api/gateway/observe/meta", { method: "PUT" }), env);
assert("unsupported method is rejected", wrongMethod.status === 405);

const invalidSignature = await worker.fetch(new Request("https://dnaos.dev/api/gateway/observe/meta", {
  method: "POST",
  headers: { "x-hub-signature-256": "sha256=invalid" },
  body: "{}",
}), env);
assert("invalid signature is rejected before parsing", invalidSignature.status === 401);

const malformedBody = "{";
const signature = `sha256=${createHmac("sha256", env.META_APP_SECRET).update(malformedBody).digest("hex")}`;
const invalidJson = await worker.fetch(new Request("https://dnaos.dev/api/gateway/observe/meta", {
  method: "POST",
  headers: { "x-hub-signature-256": signature },
  body: malformedBody,
}), env);
assert("signed malformed JSON receives a client error", invalidJson.status === 400);

const ignored = await worker.fetch(new Request("https://dnaos.dev/api/gateway/observe/meta", {
  method: "POST",
  headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", env.META_APP_SECRET).update('{"object":"user"}').digest("hex")}` },
  body: '{"object":"user"}',
}), env);
const ignoredBody = await ignored.json() as { ok?: boolean; accepted?: number; skipped?: number };
assert("unsupported event objects receive a successful ACK and are counted", ignored.status === 200 && ignoredBody.ok === true && ignoredBody.accepted === 0 && ignoredBody.skipped === 1);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * หน้าที่: the real test for ./webhook-receiver.ts. Plain program with its
 * own assertions, same convention as ./adapter.test.ts (no test framework
 * in this repo). Every case here is OFFLINE — no network — because
 * signature validation and normalization are pure functions of their
 * input plus a resolved secret; the secret is injected via the
 * TEST/LEGACY env var fallback (GITHUB_WEBHOOK_SECRET_INFRASTRUCTURE),
 * proving the exact same code path production uses, minus which resolver
 * backend supplied the string.
 *
 * How to run:
 *   npx tsx connections/github/webhook-receiver.test.ts
 */

import { createHmac } from "node:crypto";
import { handleGithubWebhookDelivery } from "./webhook-receiver";

const SECRET = "test-webhook-secret-only-for-this-run";
process.env.GITHUB_WEBHOOK_SECRET_INFRASTRUCTURE = SECRET;

let failures = 0;
function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    console.error(`FAIL ${label}`);
    failures += 1;
  }
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

const pushPayload = {
  ref: "refs/heads/main",
  before: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  after: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  repository: { name: "-DNA-OS-INFRASTRUCTURE-", owner: { login: "t23598788-oss" } },
  commits: [{ id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
  head_commit: { id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", message: "test-safe scratch edit" },
  pusher: { name: "t23598788-oss" },
};
const rawBody = JSON.stringify(pushPayload);

async function main(): Promise<void> {
  // 1. Valid signature, valid payload -> normalized EventEnvelope.
  {
    const outcome = await handleGithubWebhookDelivery({
      headers: {
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": sign(rawBody, SECRET),
        "X-GitHub-Delivery": "delivery-1",
        "X-DNA-OS-Repo-Owner": "t23598788-oss",
        "X-DNA-OS-Repo-Name": "-DNA-OS-INFRASTRUCTURE-",
      },
      raw_body: rawBody,
    });
    assert(outcome.ok === true, "valid signature + valid push payload is accepted");
    if (outcome.ok) {
      assert(outcome.event.event_type === "connector.github.push_received", "event_type is connector.github.push_received");
      assert(outcome.event.data.branch === "main", "branch normalized from refs/heads/main");
      assert(outcome.event.data.after_sha === pushPayload.after, "after_sha carried through");
      assert(outcome.event.data.commit_count === 1, "commit_count matches commits array length");
      assert(JSON.stringify(outcome.event).indexOf(SECRET) === -1, "serialized event never contains the secret");
    }
  }

  // 2. Wrong secret -> BAD_SIGNATURE, never a thrown exception.
  {
    const outcome = await handleGithubWebhookDelivery({
      headers: {
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": sign(rawBody, "wrong-secret"),
        "X-DNA-OS-Repo-Owner": "t23598788-oss",
        "X-DNA-OS-Repo-Name": "-DNA-OS-INFRASTRUCTURE-",
      },
      raw_body: rawBody,
    });
    assert(outcome.ok === false && outcome.code === "BAD_SIGNATURE", "wrong secret is rejected as BAD_SIGNATURE");
  }

  // 3. Tampered body (signature computed over the original body) -> rejected.
  {
    const tampered = rawBody.replace("main", "production-hijack");
    const outcome = await handleGithubWebhookDelivery({
      headers: {
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": sign(rawBody, SECRET),
        "X-DNA-OS-Repo-Owner": "t23598788-oss",
        "X-DNA-OS-Repo-Name": "-DNA-OS-INFRASTRUCTURE-",
      },
      raw_body: tampered,
    });
    assert(outcome.ok === false && outcome.code === "BAD_SIGNATURE", "tampered body invalidates the original signature");
  }

  // 4. Missing signature header entirely -> rejected before any HMAC compute.
  {
    const outcome = await handleGithubWebhookDelivery({
      headers: { "X-GitHub-Event": "push", "X-DNA-OS-Repo-Owner": "o", "X-DNA-OS-Repo-Name": "r" },
      raw_body: rawBody,
    });
    assert(outcome.ok === false && outcome.code === "MISSING_SIGNATURE_HEADER", "missing signature header is rejected");
  }

  // 5. Unsupported event type -> rejected, signature never even checked.
  {
    const outcome = await handleGithubWebhookDelivery({
      headers: {
        "X-GitHub-Event": "issues",
        "X-Hub-Signature-256": sign(rawBody, SECRET),
        "X-DNA-OS-Repo-Owner": "t23598788-oss",
        "X-DNA-OS-Repo-Name": "-DNA-OS-INFRASTRUCTURE-",
      },
      raw_body: rawBody,
    });
    assert(outcome.ok === false && outcome.code === "UNSUPPORTED_EVENT", "non-push event type is rejected");
  }

  // 6. No secret resolvable at all -> SECRET_UNAVAILABLE, not a crash.
  {
    delete process.env.GITHUB_WEBHOOK_SECRET_INFRASTRUCTURE;
    const outcome = await handleGithubWebhookDelivery({
      headers: {
        "X-GitHub-Event": "push",
        "X-Hub-Signature-256": sign(rawBody, SECRET),
        "X-DNA-OS-Repo-Owner": "t23598788-oss",
        "X-DNA-OS-Repo-Name": "-DNA-OS-INFRASTRUCTURE-",
      },
      raw_body: rawBody,
    });
    assert(outcome.ok === false && outcome.code === "SECRET_UNAVAILABLE", "no resolvable secret yields SECRET_UNAVAILABLE, not a throw");
    process.env.GITHUB_WEBHOOK_SECRET_INFRASTRUCTURE = SECRET;
  }

  if (failures > 0) {
    console.error(`${failures} assertion(s) failed`);
    process.exitCode = 1;
  } else {
    console.log("ALL PASS");
  }
}

main();

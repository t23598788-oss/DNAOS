import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import {
  kodChatCoreEvents,
  normalizeKodChatWebhook,
  registerKobChatWebhook,
  sendMessage,
  verifyKodChatWebhookSignature,
} from "../engines/integration-gateway/adapters/kodchat";

async function main() {
  const now = Date.now();
  const secret = "mock-webhook-secret";
  const nativePayload = {
    destination: "bot-id",
    events: [
      {
        type: "message",
        timestamp: now,
        webhookEventId: "evt-123",
        source: { type: "user", userId: "user-7", userName: "Untrusted name", roomId: "room-3" },
        message: { type: "text", id: "msg-9", text: "private text must not enter evidence" },
      },
      {
        type: "postback",
        timestamp: now,
        webhookEventId: "evt-postback",
        source: { type: "group", userId: "user-8", roomId: "room-4" },
        postback: { data: "untrusted=payload" },
      },
    ],
  };
  const body = JSON.stringify(nativePayload);
  const signature = createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(verifyKodChatWebhookSignature(body, signature, secret), true);
  assert.equal(verifyKodChatWebhookSignature(body, signature, "wrong-secret"), false);

  const inbound = normalizeKodChatWebhook(JSON.parse(body));
  assert.equal(inbound.events.length, 2);
  assert.equal(inbound.events[0].provider, "kodchat");
  assert.equal(inbound.events[0].capability, "message.received");
  assert.equal(inbound.events[1].capability, "interaction.received");
  assert.equal(inbound.events[0].session_id, "room-3");
  assert.equal("text" in inbound.events[0].evidence, false);
  assert.equal(JSON.stringify(inbound.events[0].evidence).includes("private text"), false);
  assert.equal(JSON.stringify(inbound.events[1].evidence).includes("untrusted=payload"), false);
  assert.equal(normalizeKodChatWebhook({ destination: "bot-id", events: [] }).skipped, 0);

  const queued = kodChatCoreEvents(nativePayload);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].source, "kodchat");
  assert.equal(queued[0].data.capability_id, "conversation.answer");
  assert.equal(queued[0].data.message_text, "private text must not enter evidence");

  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const success = await sendMessage({ userId: "user-7" }, " Hello ", { apiKey: "mock-api-key" }, {
    apiBaseUrl: "https://kobchat.com/api/bot/v1",
    sendMessagePath: "/messages",
  }, async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ message: { id: 123, roomId: "room-returned" } }), { status: 200 });
  });
  assert.deepEqual(success, { status: "success", data: { provider_status: 200, request_id: "123" } });
  assert.equal(capturedUrl, "https://kobchat.com/api/bot/v1/messages");
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer mock-api-key");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), { userId: "user-7", text: "Hello" });

  const roomMessage = await sendMessage({ roomId: "room-3" }, "Hello", { apiKey: "mock-api-key" }, {
    apiBaseUrl: "https://kobchat.com/api/bot/v1", sendMessagePath: "/messages",
  }, async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { roomId: "room-3", text: "Hello" });
    return new Response(JSON.stringify({}), { status: 200 });
  });
  assert.equal(roomMessage.status, "success");

  const missingCredential = await sendMessage({ userId: "user-7" }, "Hello", {}, {
    apiBaseUrl: "https://kobchat.com/api/bot/v1", sendMessagePath: "/messages",
  });
  assert.deepEqual(missingCredential, { status: "error", error_code: "CREDENTIAL_MISSING" });

  const limited = await sendMessage({ userId: "user-7" }, "Hello", { apiKey: "mock-api-key" }, {
    apiBaseUrl: "https://kobchat.com/api/bot/v1", sendMessagePath: "/messages",
  }, async () => new Response("{}", { status: 429 }));
  assert.deepEqual(limited, { status: "error", error_code: "RATE_LIMITED" });

  let registrationUrl = "";
  let registrationInit: RequestInit | undefined;
  const registration = await registerKobChatWebhook(
    "https://app.example.test/api/gateway/observe/kodchat",
    { apiKey: "mock-api-key", webhookSecret: "0123456789abcdef0123" },
    {},
    async (input, init) => {
      registrationUrl = String(input);
      registrationInit = init;
      return new Response("{}", { status: 200 });
    },
  );
  assert.deepEqual(registration, { status: "success", data: { provider_status: 200 } });
  assert.equal(registrationUrl, "https://kobchat.com/api/bot/v1/webhook");
  assert.equal(registrationInit?.method, "PUT");
  assert.equal((registrationInit?.headers as Record<string, string>).Authorization, "Bearer mock-api-key");
  assert.deepEqual(JSON.parse(String(registrationInit?.body)), {
    url: "https://app.example.test/api/gateway/observe/kodchat",
    secret: "0123456789abcdef0123",
  });

  const invalidCallback = await registerKobChatWebhook("http://app.example.test/hook", {
    apiKey: "mock-api-key", webhookSecret: "0123456789abcdef0123",
  });
  assert.deepEqual(invalidCallback, { status: "error", error_code: "INVALID_PAYLOAD" });

  console.log("Kod Chat adapter checks passed: native HMAC/webhook events, event mapping/privacy, direct and room sends, webhook registration, credential failure, and rate limit.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

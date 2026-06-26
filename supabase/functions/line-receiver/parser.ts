/**
 * LINE Event Parser
 * แปลง raw event → ParsedEvent
 */

import type { WebhookEvent, ParsedEvent } from "./types.ts";

export function parseEvent(event: WebhookEvent): ParsedEvent {
  const msg = event.message;

  let messageText = "";
  if (msg) {
    if (msg.type === "text") messageText = msg.text ?? "";
    else if (msg.type === "location") messageText = msg.address ?? msg.title ?? `${msg.latitude},${msg.longitude}`;
    else if (msg.type === "sticker") messageText = "[sticker]";
    else if (msg.type === "image") messageText = "[image]";
    else messageText = `[${msg.type}]`;
  }

  return {
    messageId: msg?.id ?? null,
    userId: event.source?.userId ?? null,
    groupId: event.source?.groupId ?? event.source?.roomId ?? null,
    replyToken: event.replyToken ?? null,
    messageType: msg?.type ?? event.type,
    messageText,
    timestamp: event.timestamp,
    source: event.source?.type ?? "unknown",
  };
}

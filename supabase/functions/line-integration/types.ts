export interface WebhookBody {
  events: WebhookEvent[];
  destination?: string;
}

export interface WebhookEvent {
  type: string;
  timestamp: number;
  replyToken?: string;
  source: LineSource;
  message?: LineMessage;
}

export interface LineSource {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
}

export interface LineMessage {
  id: string;
  type: "text" | "image" | "video" | "audio" | "file" | "location" | "sticker";
  text?: string;
  title?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface ParsedEvent {
  messageId: string | null;
  userId: string | null;
  groupId: string | null;
  replyToken: string | null;
  messageType: string;
  messageText: string;
  timestamp: number;
  source: string;
}

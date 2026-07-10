// LINE Webhook event types — one interface per event kind

export interface LineSource {
  type: "user" | "group" | "room"
  userId?: string
  groupId?: string
  roomId?: string
}

export interface LineBaseEvent {
  type: string
  webhookEventId: string
  deliveryContext: { isRedelivery: boolean }
  timestamp: number
  source: LineSource
  replyToken?: string
  mode: "active" | "standby"
}

// --- Message sub-types ---

export interface LineTextMessage {
  type: "text"
  id: string
  text: string
  quoteToken?: string
}

export interface LineLocationMessage {
  type: "location"
  id: string
  title?: string
  address?: string
  latitude: number
  longitude: number
}

export interface LineImageMessage {
  type: "image"
  id: string
  contentProvider: { type: "line" | "external"; originalContentUrl?: string }
}

export type LineMessage = LineTextMessage | LineLocationMessage | LineImageMessage | { type: string; id: string }

// --- Event types ---

export interface LineMessageEvent extends LineBaseEvent {
  type: "message"
  replyToken: string
  message: LineMessage
}

export interface LineFollowEvent extends LineBaseEvent {
  type: "follow"
  replyToken: string
}

export interface LineUnfollowEvent extends LineBaseEvent {
  type: "unfollow"
}

export interface LinePostbackEvent extends LineBaseEvent {
  type: "postback"
  replyToken: string
  postback: {
    data: string
    params?: Record<string, string>
  }
}

export type LineEvent =
  | LineMessageEvent
  | LineFollowEvent
  | LineUnfollowEvent
  | LinePostbackEvent
  | LineBaseEvent

// Parsed LINE webhook payload
export interface LineWebhookPayload {
  destination: string
  events: LineEvent[]
}

// What every handler receives
export interface HandlerContext {
  supabase: any
  event: LineEvent
  userId: string
  groupId: string | null
  replyToken: string | null
}

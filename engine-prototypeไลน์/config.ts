export type LineMode = "mock" | "real"

export type RealLineConfig = {
  mode: "real"
  channelSecret: string
  channelAccessToken: string
}

export function loadLineConfig(env: Record<string, string | undefined>): RealLineConfig | { mode: "mock" } {
  const mode = env.LINE_MODE
  if (mode === "mock") return { mode }
  if (mode !== "real") throw new Error("LINE_MODE must be explicitly set to real or mock")
  if (!env.LINE_CHANNEL_SECRET) throw new Error("LINE_CHANNEL_SECRET is required in LINE_MODE=real")
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required in LINE_MODE=real")
  return { mode, channelSecret: env.LINE_CHANNEL_SECRET, channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN }
}

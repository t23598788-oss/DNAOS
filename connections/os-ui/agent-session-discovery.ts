/**
 * หน้าที่: real, READ-ONLY VS Code agent-session discovery — the one
 * IMPLEMENTED piece of the 2026-08-20 "VS Code Agent Session Controller"
 * Work Order this round. Uses the EXISTING ./screen-reader.ts's
 * `readScreen` (macOS Accessibility API, already redacts every text-field
 * value) to enumerate visible controls in VS Code's frontmost window and
 * classify which known agent-provider panels are present, by LABEL TEXT
 * ONLY — never clicks, types, or otherwise mutates anything.
 *
 * create_agent_session / select_agent_session / submit_work_order /
 * read_agent_result are NOT implemented here (see ./work-order.ts's
 * UiActionKind header for the exact, real reason: this process cannot
 * yet distinguish a safe/idle VS Code panel from one with real,
 * in-progress human work, and the Owner's own standing rule from two
 * Work Orders ago forbids touching existing work). Building those safely
 * requires the Owner to designate a specific, confirmed-idle target
 * window first — a real, system-forced blocker, not a placeholder.
 *
 * Input: none.
 * Output: discoverAgentSessions(): Promise<DiscoveredSession[]>.
 * Dependency ที่อนุญาต: ./screen-reader.ts (readScreen — unchanged).
 * สิ่งที่ห้ามแตะ: never click/type/key here; never read a text FIELD's
 * value (readScreen already redacts every one, this file adds no new
 * capability on top of that).
 */
import { readScreen } from "./screen-reader";

export type KnownAgentProvider = "claude-code" | "codex" | "copilot" | "gemini";

export interface DiscoveredSession {
  provider: KnownAgentProvider;
  /** The real, visible tab/panel label text this was matched against — evidence, not an assumption. */
  matched_label: string;
  /** Always UNKNOWN this round — busy/idle state cannot be reliably read from the Accessibility tree alone without deeper, riskier scripting this Work Order does not authorize. */
  observed_state: "UNKNOWN";
}

export interface SessionDiscoveryResult {
  app_frontmost: string | null;
  vscode_window_active: boolean;
  sessions: DiscoveredSession[];
  raw_confidence: number;
  warnings: readonly string[];
  evidence_timestamp: string;
}

const LABEL_PATTERNS: Record<KnownAgentProvider, RegExp> = {
  "claude-code": /claude/i,
  codex: /codex/i,
  copilot: /copilot/i,
  gemini: /gemini/i,
};

/**
 * The one real entry point. Read-only. Real, bounded Accessibility read
 * of VS Code's own window (reuses ./screen-reader.ts unchanged) —
 * matches visible control labels against known provider name patterns.
 * A provider matched here means "a panel/tab with that name is visibly
 * open" — nothing stronger. Never infers session identity, task
 * assignment, or busy/idle state beyond that.
 */
export async function discoverAgentSessions(timeoutMs: number = 8_000): Promise<SessionDiscoveryResult> {
  const read = await readScreen("vscode", timeoutMs);
  const sessions: DiscoveredSession[] = [];
  const seenProviders = new Set<KnownAgentProvider>();

  const allLabels = [...read.visible_text_redacted, ...read.controls.map((c) => c.label)];
  for (const label of allLabels) {
    for (const provider of Object.keys(LABEL_PATTERNS) as KnownAgentProvider[]) {
      if (seenProviders.has(provider)) continue;
      if (LABEL_PATTERNS[provider].test(label)) {
        sessions.push({ provider, matched_label: label, observed_state: "UNKNOWN" });
        seenProviders.add(provider);
      }
    }
  }

  return {
    app_frontmost: read.app,
    vscode_window_active: read.state === "window_active",
    sessions,
    raw_confidence: read.confidence,
    warnings: read.warnings,
    evidence_timestamp: read.evidence_timestamp,
  };
}

/**
 * Human Confirm Gate
 *
 * Capability ที่ requireConfirm=true → ห้าม Execute จนกว่า confirmed=true
 * มี TTL 5 นาที — หมดเวลาต้องขอใหม่
 */

export interface PendingConfirmation {
  id: string;
  capability: string;
  app: string;
  args: Record<string, unknown>;
  stepCount: number;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "confirmed" | "denied" | "expired";
}

const pending = new Map<string, PendingConfirmation>();
const TTL = 5 * 60 * 1000; // 5 นาที
let counter = 0;

export function requestConfirmation(
  capability: string,
  app: string,
  args: Record<string, unknown>,
  stepCount: number
): PendingConfirmation {
  const now = Date.now();
  const confirmation: PendingConfirmation = {
    id: `confirm_${++counter}_${now}`,
    capability,
    app,
    args,
    stepCount,
    createdAt: now,
    expiresAt: now + TTL,
    status: "pending",
  };
  pending.set(confirmation.id, confirmation);
  return confirmation;
}

export function confirmExecution(id: string): boolean {
  const c = pending.get(id);
  if (!c) return false;
  if (c.status !== "pending") return false;
  if (Date.now() > c.expiresAt) {
    c.status = "expired";
    return false;
  }
  c.status = "confirmed";
  return true;
}

export function denyExecution(id: string): boolean {
  const c = pending.get(id);
  if (!c) return false;
  if (c.status !== "pending") return false;
  c.status = "denied";
  return true;
}

export function isConfirmed(id: string): boolean {
  const c = pending.get(id);
  if (!c) return false;
  if (Date.now() > c.expiresAt) {
    c.status = "expired";
    return false;
  }
  return c.status === "confirmed";
}

export function getPendingConfirmations(): PendingConfirmation[] {
  cleanExpired();
  return Array.from(pending.values()).filter((c) => c.status === "pending");
}

export function getConfirmation(id: string): PendingConfirmation | undefined {
  return pending.get(id);
}

function cleanExpired(): void {
  const now = Date.now();
  for (const [id, c] of pending) {
    if (c.status === "pending" && now > c.expiresAt) {
      c.status = "expired";
    }
    // ลบที่หมดอายุเกิน 10 นาที
    if (now - c.createdAt > TTL * 2) {
      pending.delete(id);
    }
  }
}

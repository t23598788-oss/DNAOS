export interface AuditPaths {
  auditPath: string;
  cursorPath: string;
}

export function readCursor(paths?: AuditPaths): number;
export function writeCursor(offset: number, paths?: Pick<AuditPaths, "cursorPath">): void;
export function initializeLiveCursor(paths?: AuditPaths): number;
export function safeText(record: unknown): string;
export function consume(
  paths?: AuditPaths,
  speak?: (text: string, timeoutMs?: number) => Promise<boolean>
): Promise<{ consumed: number; spoken: string[] }>;

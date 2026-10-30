/**
 * Debt Reminder Message Composer — PURE, no I/O, no AI, no money math.
 *
 * The caller must supply the balance it READ from the canonical ledger /
 * invoice projection. This module never computes, accrues, or adjusts a
 * financial figure — it only chooses one of three allowed states and renders
 * the approved wording for that state.
 *
 * States (mission 022 §04):
 *   BEFORE_DUE  — inside the pre-due window, due date still in the future
 *   DUE_TODAY   — due date is today
 *   OVERDUE     — due date has passed
 *
 * Policy: polite, identifies the creditor, the document, the outstanding
 * balance and one allowed contact channel. No threats, no legal pressure, no
 * disclosure to third parties (the text is addressed to the debtor alone).
 */

export type ReminderState = "BEFORE_DUE" | "DUE_TODAY" | "OVERDUE";

export interface ReminderInput {
  /** organization that is owed the money (our company) */
  creditorName: string;
  /** debtor display name — used only as the salutation */
  debtorName?: string;
  /** invoice / document reference from the canonical reader */
  documentNo: string;
  /** ISO date (YYYY-MM-DD) of the due date as stored canonically */
  dueDate: string;
  /** evaluation instant — injected for deterministic tests */
  asOf: Date;
  /** outstanding balance READ from the canonical reader (never computed here) */
  outstanding: number;
  /** the single contact channel the debtor is allowed to use (e.g. LINE OA) */
  contactChannel: string;
  /** how many days before the due date a pre-due reminder may be sent */
  windowDays?: number;
  /** stable key for idempotency (defaults to creditor+document+state+date) */
  reminderKey?: string;
}

export interface ReminderMessage {
  state: ReminderState;
  text: string;
  reminderKey: string;
  fields: {
    creditorName: string;
    documentNo: string;
    dueDate: string;
    daysUntilDue: number;
    outstanding: number;
    contactChannel: string;
  };
}

export type ReminderPlan =
  | { action: "SKIP"; reason: "NO_OUTSTANDING" | "NOT_IN_WINDOW" | "INVALID_AMOUNT" | "MISSING_REQUIRED_FIELD" }
  | { action: "SEND"; message: ReminderMessage };

/** Words that must never appear in a collection message. */
const FORBIDDEN = [
  "ฟ้อง", "ดำเนินคดี", "ยึดทรัพย์", "ยึดบ้าน", "อายัด", "ประจาน",
  "แบล็คลิสต์", "blacklist", "ขู่", "บังคับคดี",
];

const DEFAULT_WINDOW_DAYS = 7;

function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}
function parseDateOnly(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
function thaiDate(iso: string): string {
  const d = parseDateOnly(iso);
  if (!d) return iso;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
function money(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function assertReminderPolicy(text: string): void {
  const lower = text.toLowerCase();
  for (const word of FORBIDDEN) {
    if (lower.includes(word.toLowerCase())) {
      throw new Error(`REMINDER_POLICY_VIOLATION: ข้อความมีคำต้องห้าม "${word}"`);
    }
  }
}

export function planDebtReminder(input: ReminderInput): ReminderPlan {
  if (!input.creditorName || !input.documentNo || !input.contactChannel) {
    return { action: "SKIP", reason: "MISSING_REQUIRED_FIELD" };
  }
  if (!Number.isFinite(input.outstanding)) {
    return { action: "SKIP", reason: "INVALID_AMOUNT" };
  }
  if (input.outstanding <= 0) {
    return { action: "SKIP", reason: "NO_OUTSTANDING" };
  }

  const due = parseDateOnly(input.dueDate);
  if (!due) return { action: "SKIP", reason: "MISSING_REQUIRED_FIELD" };

  const daysUntilDue = dayNumber(due) - dayNumber(input.asOf);
  const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;
  if (daysUntilDue > windowDays) {
    return { action: "SKIP", reason: "NOT_IN_WINDOW" };
  }

  const state: ReminderState =
    daysUntilDue > 0 ? "BEFORE_DUE" : daysUntilDue === 0 ? "DUE_TODAY" : "OVERDUE";

  const dueText = thaiDate(input.dueDate);
  const amountText = `${money(input.outstanding)} บาท`;
  const greeting = input.debtorName ? `เรียน ${input.debtorName}\n\n` : "";

  let body: string;
  if (state === "BEFORE_DUE") {
    body =
      `แจ้งเตือนล่วงหน้า: เอกสารเลขที่ ${input.documentNo} จะครบกำหนดชำระวันที่ ${dueText} ` +
      `(อีก ${daysUntilDue} วัน) ยอดคงเหลือ ${amountText}`;
  } else if (state === "DUE_TODAY") {
    body =
      `แจ้งเตือน: เอกสารเลขที่ ${input.documentNo} ครบกำหนดชำระวันนี้ (${dueText}) ` +
      `ยอดคงเหลือ ${amountText}`;
  } else {
    body =
      `ติดตามยอดคงค้าง: เอกสารเลขที่ ${input.documentNo} ครบกำหนดชำระวันที่ ${dueText} ` +
      `เลยกำหนดมาแล้ว ${Math.abs(daysUntilDue)} วัน ยอดคงเหลือ ${amountText}`;
  }

  const text =
    `${greeting}${body}\n\n` +
    `หากชำระแล้วหรือต้องการตรวจสอบยอด กรุณาติดต่อ ${input.contactChannel}\n\n` +
    `ขอขอบคุณ\n${input.creditorName}`;

  assertReminderPolicy(text);

  const ymd = input.asOf.toISOString().slice(0, 10);
  const reminderKey =
    input.reminderKey ?? `${input.creditorName}|${input.documentNo}|${state}|${ymd}`;

  return {
    action: "SEND",
    message: {
      state,
      text,
      reminderKey,
      fields: {
        creditorName: input.creditorName,
        documentNo: input.documentNo,
        dueDate: input.dueDate,
        daysUntilDue,
        outstanding: input.outstanding,
        contactChannel: input.contactChannel,
      },
    },
  };
}

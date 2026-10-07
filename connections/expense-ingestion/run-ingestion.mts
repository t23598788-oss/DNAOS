/**
 * หน้าที่: run the whole EMAIL -> EXPENSE -> STORE -> REPORT circuit once,
 * against the real, already-proven Supabase Edge -> Gmail read path.
 * Discovery queries are subject/sender *shapes*, never a vendor allow-list —
 * whichever providers the mailbox actually contains are the providers that
 * appear in the report.
 * Input: none (reads the live mailbox through the authenticated adapter).
 * Output: a printed circuit report + rows appended to ./data/expenses.jsonl.
 * Dependency ที่อนุญาต: ../email-alert-source/authenticated-invoke, ./extractor, ./store.
 * สิ่งที่ห้ามแตะ: ห้ามทิ้งอีเมลที่ค้นเจอโดยไม่บันทึกเหตุผล — ทุกฉบับที่พบ
 * ต้องจบที่ "เป็นแถวค่าใช้จ่าย" หรือ "ถูกข้ามพร้อมเหตุผล" อย่างใดอย่างหนึ่ง.
 */
import { invokeProviderAlertEmailRead } from "../email-alert-source/authenticated-invoke.ts";
import { extractExpense, type SourceEmail } from "./extractor.ts";
import { persistExpenses, readExpenses } from "./store.ts";
import { UNKNOWN, type NormalizedExpense } from "./types.ts";

const QUERIES = [
  "subject:invoice", "subject:receipt", "subject:payment", "subject:billing",
  "subject:subscription", "subject:charged", "subject:ใบเสร็จ", "subject:ใบแจ้งหนี้",
];

const ingestedAt = new Date().toISOString();
const discovered = new Map<string, { email: SourceEmail; query: string }>();
let readFailures = 0;

for (const query of QUERIES) {
  const outcome = await invokeProviderAlertEmailRead(query, 30_000) as any;
  if (!outcome?.caller_authenticated || !outcome?.result?.ok) {
    readFailures += 1;
    console.log(`READ_FAILED  ${query}  -> ${outcome?.detail ?? outcome?.result?.reason ?? "no reason given"}`);
    continue;
  }
  const emails = outcome.result.emails ?? [];
  console.log(`READ_OK      ${query}  -> ${emails.length}`);
  for (const email of emails) {
    if (!discovered.has(email.message_id)) discovered.set(email.message_id, { email, query });
  }
}

const normalized: NormalizedExpense[] = [];
const skipped: Array<{ message_id: string; subject: string; reason: string }> = [];
for (const [, { email, query }] of discovered) {
  const extraction = extractExpense(email, query, ingestedAt);
  if (extraction.ok && extraction.expense) normalized.push(extraction.expense);
  else skipped.push({ message_id: email.message_id, subject: email.subject, reason: extraction.skipped_reason ?? "no reason recorded" });
}

const write = persistExpenses(normalized);
const persisted = readExpenses();

console.log("\n=== CIRCUIT COUNTS ===");
console.log("EXPENSE_EMAILS_DISCOVERED   =", discovered.size);
console.log("EXPENSE_RECORDS_NORMALIZED  =", normalized.length);
console.log("EXPENSE_RECORDS_PERSISTED   =", write.inserted, `(duplicates rejected: ${write.duplicates})`);
console.log("STORE_TOTAL_AFTER_WRITE     =", persisted.length);
console.log("SKIPPED_WITH_REASON         =", skipped.length);
console.log("READ_FAILURES               =", readFailures);
console.log("ACCOUNTED_FOR               =", normalized.length + skipped.length, "/", discovered.size);
for (const s of skipped) console.log("  SKIPPED", s.message_id, "|", s.subject, "|", s.reason);

console.log("\n=== TOTALS BY CURRENCY (read back from the store, not from memory) ===");
const byCurrency = new Map<string, { total: number; rows: number; unknown_amount: number }>();
for (const row of persisted) {
  const key = row.currency;
  const bucket = byCurrency.get(key) ?? { total: 0, rows: 0, unknown_amount: 0 };
  bucket.rows += 1;
  if (row.amount === UNKNOWN) bucket.unknown_amount += 1;
  else bucket.total += Number(row.amount);
  byCurrency.set(key, bucket);
}
for (const [currency, b] of byCurrency) {
  console.log(`  ${currency}: total=${b.total.toFixed(2)} across ${b.rows - b.unknown_amount} priced rows` +
              (b.unknown_amount ? `  (+${b.unknown_amount} rows with amount=UNKNOWN, excluded from the total)` : ""));
}

console.log("\n=== BY PROVIDER ===");
const byProvider = new Map<string, { rows: number; priced: number; total: number; currency: string }>();
for (const row of persisted) {
  const b = byProvider.get(row.provider) ?? { rows: 0, priced: 0, total: 0, currency: row.currency };
  b.rows += 1;
  if (row.amount !== UNKNOWN) { b.priced += 1; b.total += Number(row.amount); }
  byProvider.set(row.provider, b);
}
for (const [p, b] of [...byProvider].sort((a, c) => c[1].total - a[1].total)) {
  console.log(`  ${p.padEnd(22)} rows=${String(b.rows).padStart(3)} priced=${String(b.priced).padStart(3)} total=${b.total.toFixed(2)} ${b.currency}`);
}

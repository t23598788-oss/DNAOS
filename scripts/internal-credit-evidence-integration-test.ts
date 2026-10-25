/** Isolated contract test. It validates orchestration, not DB/Storage persistence. */
import assert from "node:assert/strict";
import { createCreditAgreement, createInternalCreditEvidenceDocument, type CreditAgreementRecord, type InternalCreditEvidenceDeps, type CreditSlipClassification, type ReviewStatus } from "../engines/canonical/internal-credit-evidence";
import { createDocumentArtifacts } from "../engines/documents/artifact";

const receipts = [
  { id: "slip-a", amount: 30000, reference_number: "TRX-A", media_path: "line/slip-a.png", customer_company_id: "borrower-1" },
  { id: "slip-b", amount: 20000, reference_number: "TRX-B", media_path: "line/slip-b.png", customer_company_id: "borrower-1" },
  { id: "repayment", amount: 5000, reference_number: "TRX-R", media_path: "line/repayment.png", customer_company_id: "borrower-1" },
];
const proposal = { id: "line-proposal", raw_text: "ข้อตกลง AGR-001 เงินต้น 50,000 บาท", event_timestamp: "2026-10-12T09:00:00+07:00", created_at: "2026-10-12T09:00:01+07:00", line_user_id: "lender-line", line_message_id: "msg-proposal", direction: "out", raw_type: "message", line_webhook_event_id: "webhook-proposal" };
const response = { id: "line-response", raw_text: "ยอมรับข้อตกลง AGR-001", event_timestamp: "2026-10-12T10:00:00+07:00", created_at: "2026-10-12T10:00:01+07:00", line_user_id: "borrower-line", line_message_id: "msg-response", direction: "in", raw_type: "message", line_webhook_event_id: "webhook-response" };
let agreement: CreditAgreementRecord | null = null;
let receiptBindings: Record<string, unknown>[] = [];
let acceptance: Record<string, unknown> | null = null;
const bindings: Record<string, unknown>[] = [];
let renderedPdf: Buffer | null = null;
let renderedPng: Buffer | null = null;
let version = 1;
const calls: string[] = [];

const deps: InternalCreditEvidenceDeps = {
  getReceipt: async (id) => receipts.find((r) => r.id === id) ?? null,
  getLineEvent: async (id) => id === proposal.id ? proposal : id === response.id ? response : null,
  insertAgreement: async (row) => { agreement = { id: "agreement-1", agreement_no: String(row.agreement_no), agreement_version: Number(row.agreement_version), status: row.status as "accepted" | "pending_review", lender_company_id: null, lender_name: String(row.lender_name), borrower_company_id: String(row.borrower_company_id), borrower_name: String(row.borrower_name), agreed_at: String(row.agreed_at), principal_amount: Number(row.principal_amount), service_fee_amount: Number(row.service_fee_amount), repayment_terms: row.repayment_terms as Record<string, unknown>, evidence_ref: String(row.evidence_ref) }; calls.push("agreement.insert"); return agreement; },
  insertReceiptBinding: async (row) => { receiptBindings.push(row); calls.push("receipt-binding.insert"); },
  insertAcceptance: async (row) => { acceptance = { id: "acceptance-1", ...row }; calls.push("acceptance.insert"); return { id: "acceptance-1", status: row.status as "accepted" | "pending_review", agreement_reference: String(row.agreement_reference), accepted_at: row.accepted_at as string | null }; },
  getAgreement: async (id) => id === agreement?.id ? agreement : null,
  getReceiptBindings: async () => receiptBindings.map((r) => ({ receipt_document_id: String(r.receipt_document_id), classification: r.classification as CreditSlipClassification, review_status: r.review_status as ReviewStatus, credited_amount: Number(r.credited_amount) })),
  getAcceptance: async () => acceptance ? { id: String(acceptance.id), status: acceptance.status as ReviewStatus, agreement_reference: String(acceptance.agreement_reference), accepted_at: acceptance.accepted_at as string | null } : null,
  getDebtSnapshot: async () => ({ customer_company_id: "borrower-1", total_outstanding: 12345.67, collection_state: "CURRENT" }),
  createDocument: async (input) => { calls.push("canonical.createDocument"); assert.equal(input.document_type, "credit_agreement"); return { document_id: "doc-1", document_kind: "standalone_document", document_no: input.document_no, totals: { subtotal: 50000, discount_amount: 0, vat_mode: "exclusive", vat_rate: 0, vat_amount: 0, gross_amount: 50000, wht_rate: 0, wht_amount: 0, net_payable: 50000 }, items_written: 1, version: { id: "version-1", version_no: 1, previous_version_id: null, data_completeness: "FULL" } }; },
  createVersion: async () => { version += 1; calls.push("canonical.createVersion"); return { id: `version-${version}`, version_no: version, previous_version_id: `version-${version - 1}`, data_completeness: "FULL" }; },
  linkInboundSource: async () => { calls.push("canonical.linkInboundSource"); },
  storeDocumentArtifacts: async (_id, data, options) => { calls.push("canonical.storeDocumentArtifacts"); const artifact = await createDocumentArtifacts(data); renderedPdf = artifact.pdf; renderedPng = artifact.image; assert.match(options.document_version_id, /^version-/); return { pdfUrl: "test://signed.pdf", imageUrl: "test://signed.png", pdfPath: "generated/test.pdf", imagePath: "generated/test.png" }; },
  insertBinding: async (row) => { bindings.push(row); calls.push("binding.insert"); return { id: `binding-${bindings.length}` }; },
  getArtifactIds: async (id) => ({ pdf: `artifact-pdf-${id}`, image: `artifact-image-${id}` }),
};

async function main() {
  const base = { agreement_no: "AGR-001", lender_name: "DNA OS Lending", borrower_name: "Borrower", agreed_at: "2026-10-12", principal_amount: 50000, repayment_terms: { due_date: "2026-11-12" }, evidence_ref: "AGR-001", actor: "isolated-test", acceptance: { proposal_line_event_id: proposal.id, response_line_event_id: response.id, agreement_reference: "AGR-001" } };
  const pending = await createCreditAgreement({ ...base, agreement_no: "AGR-PENDING", receipt_evidence: [{ receipt_document_id: "repayment", classification: "loan_repayment", review_status: "accepted", amount_basis: "gross_transfer", credited_amount: 5000 }] }, deps);
  assert.equal(pending.status, "pending_review", "repayment evidence is never auto-disbursement");
  await assert.rejects(() => createInternalCreditEvidenceDocument({ agreement_id: pending.id, document_no: "ICE-PENDING", actor: "isolated-test" }, deps), /CREDIT_EVIDENCE_PENDING_REVIEW/);
  agreement = null; receiptBindings = []; acceptance = null; calls.length = 0;
  const created = await createCreditAgreement({ ...base, receipt_evidence: [{ receipt_document_id: "slip-a", classification: "loan_disbursement", review_status: "accepted", amount_basis: "gross_transfer", credited_amount: 30000 }, { receipt_document_id: "slip-b", classification: "credit_disbursement", review_status: "accepted", amount_basis: "gross_transfer", credited_amount: 20000 }] }, deps);
  assert.equal(created.status, "accepted");
  assert.equal(receiptBindings.length, 2, "one agreement can retain multiple reviewed slips");
  const acceptanceRow = acceptance as unknown as Record<string, unknown>;
  assert.equal(acceptanceRow.acceptor_line_user_id, "borrower-line");
  assert.equal(acceptanceRow.acceptor_message_id, "msg-response");
  const first = await createInternalCreditEvidenceDocument({ agreement_id: created.id, document_no: "ICE-001", actor: "isolated-test" }, deps);
  const second = await createInternalCreditEvidenceDocument({ agreement_id: created.id, document_no: "ICE-001", actor: "isolated-test", existing_document_id: first.document_id }, deps);
  assert.equal(first.document_id, second.document_id); assert.notEqual(first.document_version_id, second.document_version_id);
  assert.equal(bindings.length, 2, "each document version retains an immutable binding");
  assert.equal(bindings[0].financial_snapshot && (bindings[0].financial_snapshot as { total_outstanding?: number }).total_outstanding, 12345.67);
  assert.ok(renderedPdf?.subarray(0, 5).toString("ascii") === "%PDF-", "renderer produced PDF bytes");
  assert.ok(renderedPng?.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "renderer produced PNG bytes");
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../engines/canonical/internal-credit-evidence.ts", import.meta.url), "utf8"));
  for (const forbidden of ["payment-write", "debt-write", "confirmPayment", "appendDebtEvent", "sendLineMessage", "sendEmail", ".rpc("]) assert.equal(source.includes(forbidden), false, `must not introduce ${forbidden}`);
  console.log("internal-credit-evidence-integration:test PASS");
  console.log("checks: reviewed multi-slip classification · repayment excluded · LINE identity/message/reference provenance · pending fail-closed · canonical version bindings · real PDF/PNG render · no finance/external delivery");
}
main().catch((error) => { console.error(error); process.exit(1); });
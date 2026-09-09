/**
 * CANONICAL_DOCUMENT_TEMPLATE_V1 — fixture templates only.
 * legal_correctness_claimed is always false until an Owner-reviewed template is registered.
 */

import type { CanonicalDocumentTemplateV1 } from "./types";

export const FIXTURE_INVOICE_TEMPLATE: CanonicalDocumentTemplateV1 = {
  schema: "CANONICAL_DOCUMENT_TEMPLATE_V1",
  template_id: "fixture.invoice.v1",
  jurisdiction: null,
  domain: "commerce",
  document_type: "INVOICE_V1",
  required_fields: ["invoice_no", "issued_on", "payer_name", "amount"],
  optional_fields: ["notes"],
  field_validation: {
    invoice_no: "string",
    issued_on: "iso_date",
    payer_name: "string",
    amount: "number",
  },
  layout_regions: ["header", "parties", "lines", "totals", "footer"],
  format_rules: ["no_arbitrary_html", "registered_regions_only"],
  number_date_currency_rules: { amount: "decimal_2", issued_on: "ISO-8601", currency: "declared_iso_code" },
  signature_approval_requirements: ["OWNER_REVIEW_BEFORE_EXPORT"],
  export_formats: ["json", "txt"],
  template_version: "1",
  legal_correctness_claimed: false,
};

export const FIXTURE_RECEIPT_TEMPLATE: CanonicalDocumentTemplateV1 = {
  ...FIXTURE_INVOICE_TEMPLATE,
  template_id: "fixture.receipt.v1",
  document_type: "PAYMENT_SUMMARY_V1",
  required_fields: ["receipt_no", "paid_on", "payer_name", "amount"],
  field_validation: {
    receipt_no: "string",
    paid_on: "iso_date",
    payer_name: "string",
    amount: "number",
  },
};

export const DOCUMENT_TEMPLATES: Readonly<Record<string, CanonicalDocumentTemplateV1>> = {
  [FIXTURE_INVOICE_TEMPLATE.template_id]: FIXTURE_INVOICE_TEMPLATE,
  [FIXTURE_RECEIPT_TEMPLATE.template_id]: FIXTURE_RECEIPT_TEMPLATE,
};

export function getDocumentTemplate(template_id: string): CanonicalDocumentTemplateV1 | null {
  return DOCUMENT_TEMPLATES[template_id] ?? null;
}

export function listDocumentTemplates(): readonly CanonicalDocumentTemplateV1[] {
  return Object.values(DOCUMENT_TEMPLATES);
}

# DNA OS — A4 document style extracted from photo

This is a reconstruction of layout, not an exact font identification or a live
invoice. Paper texture and yellow/gray photographic lighting are not reproduced.
Customer identifiers, bank account, stamp and verification hash are placeholders.
Company text was transcribed from the photograph; confirm before issuance.

## Page and structure

- A4 portrait: 210 × 297 mm, top margin 14 mm, side margins 12 mm.
- Header: company/logo on the left; document title, number and date on the right.
- Black 2 pt divider; two bordered party boxes underneath.
- Table columns: transaction date 12%, description 42%, quantity 9%, unit 9%,
  unit price 14%, amount 14%. Black header; numeric columns right aligned.
- Summary on right (74 mm); grand total white on black.
- Full-width amount-in-words, payment note, terms and evidence reference.
- Two signature columns; reserved stamp space; company footer.

## Palette (visual approximations, not calibrated color samples)

| Use | Hex |
| --- | --- |
| Clean digital paper | #FFFFFF |
| Main type / table / grand total | #101010 |
| Secondary labels | #737980 |
| Box borders | #D9D9D5 |
| Amount / terms accent | #163B70 |
| Terms background | #EEF2F7 |
| Payment-note accent | #92512F |
| Payment-note background | #FAF4E9 |

## Typography

Exact family cannot be proven from the photograph. The existing repository
template (`engines/documents/template.ts`) specifies Sarabun, but is a different
layout and does not prove the photographed document used that font.

This standalone reconstruction embeds the locally available **Noto Sans Thai**
400 and 700 as a substitute. Latin letters use its Latin subset. Logo uses Arial
Bold; document numbers and transaction references use monospace.

| Element | Size / weight |
| --- | --- |
| DNA OS wordmark | 25 pt / 700, 3 pt tracking |
| Tagline | 6 pt / 400, 2.5 pt tracking |
| Document title | 12 pt / 700 |
| Company name | 11 pt / 700 |
| Party names | 10 pt / 700 |
| Body / amounts | 8–9 pt / 400–700 |
| Grand total | 12 pt / 700 |
| Labels / footer | 6–7.5 pt / 400 |

`template.html` is editable and printable; `output/pdf/dna-os-document-a4.pdf`
is its A4 print export. This template is not wired into the production document
engine, does not issue a document, and does not calculate authoritative totals.

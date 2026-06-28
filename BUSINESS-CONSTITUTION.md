# Business Constitution

## Business Dictionary

| Term | ไทย |
| --- | --- |
| `quotation` | ใบเสนอราคา |
| `boq` | ใบประมาณปริมาณงาน |
| `invoice` | ใบแจ้งหนี้ |
| `receipt` | ใบเสร็จรับเงิน |
| `purchase_order` | ใบสั่งซื้อ |
| `delivery_order` | ใบส่งสินค้า |

## Document Type Rules

These are the canonical document types. Document templates must keep one shared shape and change behavior only through `document_type`.

### `quotation`

- owner: `Sales`
- workflow: `quotation.review`
- storage: `documents`
- command:
  - `review_quotation`
  - `list_quotation`
  - `create_quotation`

### `boq`

- owner: `Engineering`
- workflow: `boq.review`
- storage: `documents`
- command:
  - `review_boq`
  - `list_boq`
  - `create_boq`

### `invoice`

- owner: `Finance`
- workflow: `invoice.issue`
- storage: `documents`
- command:
  - `issue_invoice`

### `receipt`

- owner: `Finance`
- workflow: `receipt.issue`
- storage: `documents`
- command: []

### `purchase_order`

- owner: `Procurement`
- workflow: `purchase_order.issue`
- storage: `documents`
- command: []

### `delivery_order`

- owner: `Operations`
- workflow: `delivery_order.issue`
- storage: `documents`
- command: []

### `billing`

- owner: `Finance`
- workflow: `billing.issue`
- storage: `documents`
- command: []

## Command To Document Type Mapping

| Command | Document Type |
| --- | --- |
| `review_quotation` | `quotation` |
| `list_quotation` | `quotation` |
| `create_quotation` | `quotation` |
| `review_boq` | `boq` |
| `list_boq` | `boq` |
| `create_boq` | `boq` |
| `issue_invoice` | `invoice` |

## Enforcement Rules

### Rule 001

- command: `review_quotation`
- operation: `query`
- must use:
  - `document_type = quotation`

### Rule 002

- command: `review_boq`
- operation: `query`
- must use:
  - `document_type = boq`

### Rule 003

- command: `issue_invoice`
- operation: `create`
- must use:
  - `document_type = invoice`

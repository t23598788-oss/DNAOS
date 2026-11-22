export interface StockUpdateInput {
  adapterId: string;
  idempotencyKey: string;
  externalEntryKey: string;
  externalItemCode: string;
  externalWarehouseKey: string;
  quantityDelta: number;
  stockUom: string;
  occurredAt: string;
  sourceDocumentKey: string | null;
}

export interface StockUpdateResult {
  ok: true;
  replayed: boolean;
  movement_id: string;
  balance_observation_id?: string;
  quantity_before?: number;
  quantity_delta: number;
  quantity_after: number | null;
}

export interface StockUpdateStore {
  applyMovement(input: StockUpdateInput): Promise<StockUpdateResult>;
}

export class StockUpdateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockUpdateInputError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: unknown, field: string, max = 240): string {
  if (typeof value !== "string") throw new StockUpdateInputError(`${field} is required`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new StockUpdateInputError(`${field} must be 1-${max} characters`);
  }
  return normalized;
}

export function parseStockUpdate(value: unknown): StockUpdateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StockUpdateInputError("JSON object required");
  }
  const body = value as Record<string, unknown>;
  if (body.schema_version !== "1.0" || body.event_type !== "stock.movement.recorded") {
    throw new StockUpdateInputError("unsupported schema_version or event_type");
  }

  const adapterId = requiredText(body.adapter_id, "adapter_id");
  if (!UUID_RE.test(adapterId)) throw new StockUpdateInputError("adapter_id must be a UUID");

  const quantityDelta = body.quantity_delta;
  if (typeof quantityDelta !== "number" || !Number.isFinite(quantityDelta) || quantityDelta === 0) {
    throw new StockUpdateInputError("quantity_delta must be a finite non-zero number");
  }

  const occurredAt = requiredText(body.occurred_at, "occurred_at", 64);
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new StockUpdateInputError("occurred_at must be a valid timestamp");
  }

  const sourceDocumentKey = body.source_document_key == null
    ? null
    : requiredText(body.source_document_key, "source_document_key");

  return {
    adapterId,
    idempotencyKey: requiredText(body.idempotency_key, "idempotency_key"),
    externalEntryKey: requiredText(body.external_entry_key, "external_entry_key"),
    externalItemCode: requiredText(body.external_item_code, "external_item_code"),
    externalWarehouseKey: requiredText(body.external_warehouse_key, "external_warehouse_key"),
    quantityDelta,
    stockUom: requiredText(body.stock_uom, "stock_uom", 40),
    occurredAt: new Date(occurredAt).toISOString(),
    sourceDocumentKey,
  };
}

/** Parse and atomically store a compact movement through the supplied store. */
export async function ingestStockUpdate(
  value: unknown,
  store: StockUpdateStore,
): Promise<StockUpdateResult> {
  return ingestParsedStockUpdate(parseStockUpdate(value), store);
}

export async function ingestParsedStockUpdate(
  input: StockUpdateInput,
  store: StockUpdateStore,
): Promise<StockUpdateResult> {
  return store.applyMovement(input);
}

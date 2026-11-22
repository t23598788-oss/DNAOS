import assert from "node:assert/strict";
import {
  ingestStockUpdate,
  type StockUpdateInput,
  type StockUpdateResult,
  type StockUpdateStore,
} from "../engines/integration-gateway/stockIngestion.js";

const adapterId = "8f2f1e7a-21cb-4f79-8bda-36c25a9af7a1";
const request = {
  schema_version: "1.0",
  event_type: "stock.movement.recorded",
  adapter_id: adapterId,
  idempotency_key: "test-sale-60-001",
  external_entry_key: "test-sale-60-001",
  external_item_code: "TEST-ITEM",
  external_warehouse_key: "TEST-WH",
  quantity_delta: -60,
  stock_uom: "ชิ้น",
  occurred_at: "2026-11-16T12:00:00.000Z",
} as const;

class InMemoryStockStore implements StockUpdateStore {
  quantity = 100;
  readonly movements = new Map<string, { input: StockUpdateInput; result: StockUpdateResult }>();
  observations: number[] = [100];

  async applyMovement(input: StockUpdateInput): Promise<StockUpdateResult> {
    const existing = this.movements.get(input.idempotencyKey);
    if (existing) {
      assert.deepEqual(existing.input, input, "idempotency key cannot be reused for different movement data");
      return { ...existing.result, replayed: true };
    }

    this.quantity += input.quantityDelta;
    const result: StockUpdateResult = {
      ok: true,
      replayed: false,
      movement_id: `movement-${this.movements.size + 1}`,
      balance_observation_id: `observation-${this.observations.length + 1}`,
      quantity_before: this.quantity - input.quantityDelta,
      quantity_delta: input.quantityDelta,
      quantity_after: this.quantity,
    };
    this.movements.set(input.idempotencyKey, { input, result });
    this.observations.push(this.quantity);
    return result;
  }
}

async function main() {
  const store = new InMemoryStockStore();
  const first = await ingestStockUpdate(request, store);
  assert.equal(first.quantity_before, 100);
  assert.equal(first.quantity_delta, -60);
  assert.equal(first.quantity_after, 40);
  assert.equal(store.movements.size, 1);
  assert.deepEqual(store.observations, [100, 40]);

  const replay = await ingestStockUpdate(request, store);
  assert.equal(replay.replayed, true);
  assert.equal(replay.quantity_after, 40);
  assert.equal(store.movements.size, 1, "a replay must not append a duplicate movement");
  assert.deepEqual(store.observations, [100, 40], "a replay must not append a duplicate state observation");

  await assert.rejects(
    () => ingestStockUpdate({ ...request, quantity_delta: 0 }, store),
    /quantity_delta must be a finite non-zero number/,
  );

  console.log("Stock ingestion simulation passed: 100 - 60 = 40; replay was idempotent; no duplicate state/event.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

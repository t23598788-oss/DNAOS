/**
 * Collection Fee — ค่าทวงถาม
 *
 * ต้องไม่เกินเพดานกฎหมาย (collection_fee_limit จาก policy)
 * กฎหมายเปลี่ยน → เปลี่ยน policy → ไม่ต้องแก้สูตร
 */

export interface CollectionFeeInput {
  outstanding: number;
  feeRate: number;
  legalLimit: number;
}

export interface CollectionFeeResult {
  calculatedFee: number;
  legalLimit: number;
  appliedFee: number;
  cappedByLaw: boolean;
}

export function calcCollectionFee(input: CollectionFeeInput): CollectionFeeResult {
  const calculatedFee = Math.round(input.outstanding * (input.feeRate / 100) * 100) / 100;
  const cappedByLaw = calculatedFee > input.legalLimit;
  const appliedFee = cappedByLaw ? input.legalLimit : calculatedFee;

  return { calculatedFee, legalLimit: input.legalLimit, appliedFee, cappedByLaw };
}

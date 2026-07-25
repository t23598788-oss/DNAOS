export interface RawPricingData {
  configs?: {
    markupPercent?: number;
  };
  materialBasePrice?: number;
  transportCostPerTrip?: number;
  quantity?: number;
  trips?: number;
  vehicle_type?: string | null;
  resolvedMatName?: string;
  targetDistance?: number;
  matchedPitName?: string;
}

export interface SanitizedPricing {
  resolvedMatName: string;
  quantity: number;
  targetDistance: number;
  trips: number;
  matchedPitName: string;
  customerMaterialUnitPrice: number;
  customerMaterialTotal: number;
  customerTransportUnitPrice: number;
  customerTransportTotal: number;
  customerNetTotal: number;
}

/**
 * Sanitizer Layer Firewall.
 * Applies retail markups (25%) to raw cost rates and masks internal variables
 * (fuelPrice, profit margin) before customer exposure.
 */
export function sanitizePricing(raw: RawPricingData): SanitizedPricing {
  const markupPercent = raw.configs?.markupPercent ?? 25.00;
  const markupMultiplier = 1 + (markupPercent / 100);

  const rawBasePrice = raw.materialBasePrice ?? 120.00;
  const rawTransportPerTrip = raw.transportCostPerTrip ?? 0.00;
  const quantity = raw.quantity ?? 0;
  const trips = raw.trips ?? 0;

  // 1. Calculate marked-up retail pricing
  const customerMaterialUnitPrice = parseFloat((rawBasePrice * markupMultiplier).toFixed(2));
  const customerMaterialTotal = parseFloat((quantity * customerMaterialUnitPrice).toFixed(2));
  const customerTransportUnitPrice = parseFloat((rawTransportPerTrip * markupMultiplier).toFixed(2));
  const customerTransportTotal = parseFloat((trips * customerTransportUnitPrice).toFixed(2));
  const customerNetTotal = customerMaterialTotal + customerTransportTotal;

  // 2. Mask physical pit supplier identity
  const matchedPitName = "บ่อวัสดุในระบบ"; 

  return {
    resolvedMatName: raw.resolvedMatName ?? "วัสดุในระบบ",
    quantity,
    targetDistance: raw.targetDistance ?? 15.00,
    trips,
    matchedPitName,
    customerMaterialUnitPrice,
    customerMaterialTotal,
    customerTransportUnitPrice,
    customerTransportTotal,
    customerNetTotal
  };
}

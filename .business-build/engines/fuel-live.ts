// Real gap, owner-reported 2026-07-30: asked the secretary chat "ดึงค่าน้ำมัน
// มาให้ทั้งหมดหน่อย น้ำมันทุกชนิดเลย" (pull every fuel price, all types) —
// the existing fuel-price chat answer only ever knew the single DIESEL B20
// figure stored in app_configs.fuel-price (fuel-price-sync's own deliberately
// narrow pick for engines/fuel.ts's cost calculations, per that file's own
// scope note). Bangchak's same public retail-price API (confirmed live via
// direct curl, 2026-07-30) actually returns every retail fuel type — diesel
// variants, gasohol E20/E85/91/95, premium grades — in one response. This
// reads that live, in full, only for a "give me every fuel price" chat
// question; it does not replace fuel-price-sync's own single-value sync
// (engines/fuel.ts's cost calc still only ever needs DIESEL B20).

export interface FuelPriceRow {
  name: string;
  priceToday: number;
}

const BANGCHAK_API = "https://oil-price.bangchak.co.th/ApiOilPrice2/en";

export async function getAllBangchakFuelPrices(): Promise<{ prices: FuelPriceRow[]; effectiveDate: string } | null> {
  try {
    const res = await fetch(BANGCHAK_API, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const payload = await res.json();
    const row = payload?.[0];
    if (!row?.OilList) return null;
    const oilList: { OilName: string; PriceToday: number }[] = JSON.parse(row.OilList);
    return {
      prices: oilList.map((o) => ({ name: o.OilName, priceToday: Number(o.PriceToday) })),
      effectiveDate: row.OilPriceDate as string,
    };
  } catch {
    return null; // honest failure — never fabricate a price list
  }
}

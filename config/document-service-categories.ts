export const DOCUMENT_SERVICE_CATEGORIES = [
  { id: "UNSPECIFIED", th: "ไม่ระบุ", en: "Unspecified" },
  { id: "SAND", th: "ทราย", en: "Sand Supply" },
  { id: "ROCK", th: "หิน", en: "Rock / Aggregate" },
  { id: "SOIL", th: "ดิน", en: "Fill Soil" },
  { id: "TRANSPORT", th: "ขนส่ง", en: "Logistics" },
  { id: "IRRIGATION", th: "ชลประทาน 17km", en: "Irrigation Road" },
  { id: "MGMT", th: "บริหารระบบ", en: "System Mgmt" },
  { id: "MIXED", th: "รายการผสม", en: "Mixed" },
] as const

export type DocumentServiceCategory = (typeof DOCUMENT_SERVICE_CATEGORIES)[number]["id"]
export const DEFAULT_DOCUMENT_SERVICE_CATEGORY: DocumentServiceCategory = "UNSPECIFIED"

export function getServiceCategoryMeta(category: DocumentServiceCategory) {
  return DOCUMENT_SERVICE_CATEGORIES.find((item) => item.id === category) ?? DOCUMENT_SERVICE_CATEGORIES[0]
}

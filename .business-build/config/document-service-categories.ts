export const DOCUMENT_SERVICE_CATEGORIES = [
  { id: "UNSPECIFIED", th: "ไม่ระบุ" },
  { id: "SAND", th: "ทราย" },
  { id: "ROCK", th: "หิน" },
  { id: "SOIL", th: "ดิน" },
  { id: "TRANSPORT", th: "ขนส่ง" },
  { id: "MGMT", th: "บริหารระบบ" },
  { id: "MIXED", th: "รายการผสม" },
] as const

export type DocumentServiceCategory = (typeof DOCUMENT_SERVICE_CATEGORIES)[number]["id"]
export const DEFAULT_DOCUMENT_SERVICE_CATEGORY: DocumentServiceCategory = "UNSPECIFIED"

export function getServiceCategoryMeta(category: DocumentServiceCategory) {
  return DOCUMENT_SERVICE_CATEGORIES.find((item) => item.id === category) ?? DOCUMENT_SERVICE_CATEGORIES[0]
}

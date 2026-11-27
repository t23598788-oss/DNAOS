import { CONNECTION_CATEGORIES, EXTERNAL_SERVICE_CATALOG } from "@/registry/external-service-catalog";

export const docsHome = "/developers";
export const services = EXTERNAL_SERVICE_CATALOG.filter((service) => service.id !== "railway");
export const categories = CONNECTION_CATEGORIES.filter((category) =>
  services.some((service) => service.categoryId === category.id)
);

export const docsNav = [
  { label: "เริ่มต้น", links: [
    { href: docsHome, title: "ภาพรวม" },
    { href: `${docsHome}/quickstart`, title: "เริ่มใช้งาน" },
    { href: `${docsHome}/authentication`, title: "บัญชีและ API Token" },
  ] },
  { label: "อ้างอิง API", links: [
    { href: `${docsHome}/api/spec`, title: "GET · รายการคำสั่ง" },
    { href: `${docsHome}/api/query`, title: "POST · เรียกคำสั่งอ่าน" },
    { href: `${docsHome}/errors`, title: "สถานะและข้อผิดพลาด" },
  ] },
  { label: "เชื่อมต่อบริการ", links: [
    { href: `${docsHome}/integrations`, title: "รายการบริการ" },
    { href: `${docsHome}/integrations/line`, title: "LINE Official Account" },
  ] },
];

export const specExample = 'curl "$DNA_BASE_URL/api/v1/spec"';
export const queryExample = [
  'curl -X POST "$DNA_BASE_URL/api/v1/query" \\',
  '  -H "X-DNA-Token: $DNA_TOKEN" \\',
  '  -H "Content-Type: application/json" \\',
  `  --data '{"command":"debt.list","args":{}}'`,
].join("\n");

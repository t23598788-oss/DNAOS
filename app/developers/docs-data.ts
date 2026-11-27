import { CONNECTION_CATEGORIES, EXTERNAL_SERVICE_CATALOG } from "@/registry/external-service-catalog";

import { desktopGuides, hardwareGuides, metaMcpGuide } from "./integration-guides";

export const docsHome = "/developers";
export const services = EXTERNAL_SERVICE_CATALOG.filter((service) => service.id !== "railway");
// The guide groups compute providers by what they do. The connection registry
// remains the source of service names, routes, and connection capabilities.
const computeProviders = new Set(["digitalocean-runtime", "runpod"]);
const guideCategoryNames: Readonly<Record<string, string>> = {
  channels: "แพลตฟอร์มสื่อสารและแจ้งเตือน",
  "business-data": "เว็บไซต์และแพลตฟอร์มออนไลน์",
};
const docsCategories = CONNECTION_CATEGORIES.flatMap(({ id, name }) => id === "ai"
  ? [{ id, name: "AI / LLM" }, { id: "compute", name: "ผู้ให้บริการโครงสร้างพื้นฐานการประมวลผล" }]
  : [{ id, name: guideCategoryNames[id] ?? name }]
);

const catalogCategories = docsCategories.map((category) => ({
  ...category,
  services: services.filter((service) =>
    category.id === (computeProviders.has(service.id) ? "compute" : service.categoryId)
  ),
})).filter((category) => category.services.length > 0);

export const categories = [
  ...catalogCategories.map((category) => category.id === "developer-protocols"
    ? { ...category, services: [...category.services, metaMcpGuide] }
    : category),
  { id: "hardware", name: "ทะเบียน ภาษี และรอบซ่อมบำรุง", services: hardwareGuides },
  { id: "desktop", name: "ปลั๊กอินในเครื่อง Mac", services: desktopGuides },
];

export const docsNav = [
  { label: "เอกสารนักพัฒนา", links: [
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

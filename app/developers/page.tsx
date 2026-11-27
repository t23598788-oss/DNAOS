import Link from "next/link";
import { DocsArticle, docLink } from "./DocsArticle";
import LegacyDocLinks from "./LegacyDocLinks";
import { categories, docsHome, services } from "./docs-data";

export const metadata = { title: "เอกสารนักพัฒนา · DNA OS" };

const legacyDestinations = {
  quickstart: `${docsHome}/quickstart`,
  authentication: `${docsHome}/authentication`,
  examples: `${docsHome}/quickstart#first-query`,
  reference: `${docsHome}/api/spec`,
  errors: `${docsHome}/errors`,
  integrations: `${docsHome}/integrations`,
  ...Object.fromEntries(categories.map(({ id }) => [`category-${id}`, `${docsHome}/integrations#category-${id}`])),
  ...Object.fromEntries(services.map(({ id }) => [`service-${id}`, `${docsHome}/integrations/${id}#service-${id}`])),
};

export default function DevelopersPage() {
  return (
    <DocsArticle current={docsHome} title="เริ่มต้นกับ DNA OS"
      description="คู่มือเรียกข้อมูลจาก DNA OS และเชื่อมต่อช่องทางที่ระบบของคุณใช้อยู่"
      sections={[
        { id: "first-steps", title: "เรียก API ครั้งแรก", content: <p>เริ่มจากดูคำสั่งที่ระบบรองรับ แล้วใช้ API Token ของบัญชีเพื่อเรียกข้อมูลตามสิทธิ์ <Link href="/developers/quickstart" className={docLink}>เริ่มใช้งาน</Link></p> },
        { id: "integration-guides", title: "เชื่อมต่อบริการ", content: <p>เปิด <Link href="/developers/integrations" className={docLink}>รายการบริการ</Link> หรือไปตรงที่ <Link href="/developers/integrations/line#service-line" className={docLink}>คู่มือ LINE OA</Link> เพื่อดูเส้นทางตั้งค่าและสถานะที่รองรับ</p> },
      ]}>
      <LegacyDocLinks destinations={legacyDestinations} />
    </DocsArticle>
  );
}

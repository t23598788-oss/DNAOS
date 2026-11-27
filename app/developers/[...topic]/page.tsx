import Link from "next/link";
import { notFound } from "next/navigation";
import { CodeSample, DocsArticle, docLink, type DocSection } from "../DocsArticle";
import { categories, docsHome, queryExample, services, specExample } from "../docs-data";

type Doc = { title: string; description: string; sections: DocSection[] };

const docs: Record<string, Doc> = {
  quickstart: {
    title: "เริ่มใช้งาน API",
    description: "ดูรายการคำสั่งก่อน แล้วลองอ่านข้อมูลด้วยบัญชีที่มีสิทธิ์",
    sections: [
      { id: "before-you-begin", title: "เตรียม URL และบัญชี", content: <p>ตั้ง <code>DNA_BASE_URL</code> เป็น URL ของระบบที่กำลังใช้งาน สำหรับเว็บนี้ใช้ <code>https://dnaos.dev</code> การอ่านข้อมูลต้องมี <Link className={docLink} href="/developers/authentication">API Token</Link> ของบัญชีที่มีสิทธิ์ API และมีขอบเขตข้อมูลองค์กร</p> },
      { id: "first-request", title: "ดูคำสั่งที่รองรับ", content: <><CodeSample>{specExample}</CodeSample><Link className={docLink} href="/api/v1/spec">เปิดผล JSON จาก API</Link></> },
      { id: "first-query", title: "ลองเรียกคำสั่งอ่าน", content: <><p>ตั้ง <code>DNA_TOKEN</code> เป็น token ของบัญชีทดสอบ ตัวอย่างนี้เรียก <code>debt.list</code> เพื่ออ่านรายการลูกหนี้ที่ยังเปิดอยู่ตามสิทธิ์ของบัญชี</p><CodeSample>{queryExample}</CodeSample></> },
      { id: "next", title: "ขั้นต่อไป", content: <p>ดู <Link className={docLink} href="/developers/api/query">รูปแบบคำขอและผลตอบกลับ</Link></p> },
    ],
  },
  authentication: {
    title: "บัญชีและ API Token",
    description: "ใช้ token ของบัญชี DNA OS เพื่อให้ระบบรู้ว่าใครขอข้อมูลและอ่านอะไรได้",
    sections: [
      { id: "create-token", title: "สร้างและจัดการ token", content: <p>เมื่อเปิดหน้าจัดการ API Token ให้บัญชีของคุณแล้ว ให้เข้าสู่ระบบและเปิดเมนูจัดการ API Token เลือกขอบเขต <code>read</code> สำหรับคำขออ่านข้อมูล หน้านี้ใช้สำหรับสร้างและยกเลิก token ของบัญชีตัวเอง</p> },
      { id: "send-token", title: "ส่ง token ใน header", content: <><p>ส่ง <code>X-DNA-Token</code> กับคำขอ <code>POST /api/v1/query</code> เก็บ token ในตัวแปรสภาพแวดล้อมของเครื่องมือที่เรียก API</p><CodeSample>{'X-DNA-Token: <token ของบัญชีคุณ>'}</CodeSample></> },
      { id: "access", title: "สิทธิ์ของบัญชี", content: <p>API ตรวจบทบาทปัจจุบันและขอบเขตข้อมูลของเจ้าของ token ทุกคำขอ คำสั่งธุรกิจอย่าง <code>debt.list</code> ต้องมีองค์กรที่ยืนยันแล้ว หรือสิทธิ์ระดับแพลตฟอร์มตามกติกา ส่วน <Link className={docLink} href="/api/v1/spec">รายการคำสั่ง API</Link> เปิดอ่านได้ก่อนเข้าสู่ระบบ</p> },
    ],
  },
  "api/spec": {
    title: "รายการคำสั่ง API",
    description: "GET /api/v1/spec · รายการคำสั่งอ่านและพารามิเตอร์จากทะเบียนปัจจุบัน",
    sections: [
      { id: "request", title: "คำขอ", content: <><p>เรียกได้โดยไม่ต้องส่ง token</p><CodeSample>{specExample}</CodeSample></> },
      { id: "response", title: "ผลตอบกลับ", content: <p>ผลเป็น JSON มีข้อมูลระบบและข้อกำหนดของเครื่องมืออ่านแต่ละตัว <Link className={docLink} href="/api/v1/spec">เปิดผล JSON จริง</Link></p> },
      { id: "next", title: "ลองใช้คำสั่ง", content: <Link className={docLink} href="/developers/api/query">ดูวิธีส่งคำขออ่านข้อมูล</Link> },
    ],
  },
  "api/query": {
    title: "เรียกคำสั่งอ่าน",
    description: "POST /api/v1/query · ส่งคำสั่งที่ลงทะเบียนไว้เพื่ออ่านข้อมูลตามสิทธิ์ของบัญชี",
    sections: [
      { id: "request", title: "คำขอ", content: <><p>ส่ง <code>X-DNA-Token</code> และ JSON ที่มี <code>command</code> กับ <code>args</code> ดูคำสั่งที่รองรับจาก <Link href="/api/v1/spec" className={docLink}>รายการคำสั่งจริง</Link></p><CodeSample>{queryExample}</CodeSample></> },
      { id: "response", title: "ผลตอบกลับ", content: <p>เมื่อสำเร็จ API คืน <code>ok</code>, <code>command</code>, <code>user</code>, <code>data</code> และ <code>capability</code> ข้อมูลใน <code>data</code> ขึ้นกับคำสั่งและขอบเขตของผู้ถือ token</p> },
      { id: "errors", title: "เมื่อเรียกไม่สำเร็จ", content: <p>ตรวจสถานะและข้อความ <code>error</code> ในผลตอบกลับ คำสั่งที่ต้องยืนยันจะถูกปฏิเสธและให้ทำผ่านหน้าจัดการ <Link className={docLink} href="/developers/errors">ดูรหัสข้อผิดพลาด</Link></p> },
    ],
  },
  errors: {
    title: "สถานะและข้อผิดพลาด",
    description: "ตรวจสถานะ HTTP และข้อความจาก POST /api/v1/query เพื่อหาจุดที่ต้องแก้",
    sections: [
      { id: "request-errors", title: "คำขอและสิทธิ์", content: <dl className="grid grid-cols-[3rem_1fr] gap-y-2"><dt><code>400</code></dt><dd>ตรวจ JSON ชื่อคำสั่ง พารามิเตอร์ หรือขอบเขตองค์กร หากข้อความระบุ <code>DATA_SCOPE_REQUIRED</code></dd><dt><code>401</code></dt><dd>token ขาด ไม่ถูกต้อง หรือถูกยกเลิก</dd><dt><code>403</code></dt><dd>บัญชีไม่มีสิทธิ์ หรือคำสั่งต้องยืนยันผ่านหน้าจัดการ</dd></dl> },
      { id: "service-errors", title: "ความพร้อมของระบบ", content: <p><code>503</code> ระบบตรวจ token ไม่พร้อมใช้งาน หากผลตอบกลับมี <code>request_id</code> ให้เก็บรหัสนั้นเพื่อแจ้งตรวจสอบ</p> },
    ],
  },
};

function resolveDoc(topic: string): Doc | undefined {
  if (Object.hasOwn(docs, topic)) return docs[topic];
  if (topic === "integrations") {
    return {
      title: "คู่มือเชื่อมต่อบริการ",
      description: "เลือกบริการเพื่อดูวิธีตั้งค่าและขอบเขตที่ระบบรองรับ",
      sections: categories.map((category) => ({
        id: `category-${category.id}`,
        title: category.name,
        content: <ul className="space-y-1">{category.services.map((item) => (
          <li key={item.id}><Link className={docLink} href={`/developers/integrations/${item.id}`}>{item.name}</Link></li>
        ))}</ul>,
      })),
    };
  }

  const service = services.find((item) => topic === `integrations/${item.id}`);
  if (!service) return undefined;
  const canConfigure = service.userConnection !== "not_implemented";

  return {
    title: service.name,
    description: service.description,
    sections: [
      { id: `service-${service.id}`, title: "การใช้งานใน DNA OS", content: <>
        {service.id === "line" && <p>ใช้บัญชี DNA OS ของเจ้าของเพื่อผูก LINE OA ในหน้าตั้งค่า โดยกรอก Channel ID, Channel Secret และ Access Token ของ OA ระบบตรวจ token กับ LINE ก่อนบันทึก</p>}
        {canConfigure
          ? <p>เมื่อเปิดหน้าตั้งค่าบริการให้บัญชีของคุณแล้ว ให้เลือก {service.name} ในเมนูช่องเชื่อมต่อ</p>
          : <p>บริการนี้ยังไม่มีทางเชื่อมบัญชีรายผู้ใช้ใน DNA OS</p>}
      </> },
      ...(service.id === "line" ? [{
        id: "webhook", title: "รับเหตุการณ์จาก LINE",
        content: <p>คัดลอก Webhook URL จากหน้าตั้งค่า LINE OA ไปบันทึกใน Messaging API ของ OA แล้วกด Verify ใช้ URL ที่ LINE เข้าถึงได้ ตัวอย่าง <code>127.0.0.1</code> ใช้ทดสอบจากเครื่องนี้เท่านั้น</p>,
      }] : []),
      ...(service.sourceUrl ? [{ id: "provider-docs", title: "เอกสารผู้ให้บริการ", content: <a href={service.sourceUrl} className={docLink} rel="noreferrer" target="_blank">{service.sourceLabel || "เปิดคู่มือ"}</a> }] : []),
    ],
  };
}

type PageProps = { params: Promise<{ topic: string[] }> };

export function generateStaticParams() {
  return [...Object.keys(docs), "integrations", ...services.map(({ id }) => `integrations/${id}`)]
    .map((path) => ({ topic: path.split("/") }));
}

export async function generateMetadata({ params }: PageProps) {
  const doc = resolveDoc((await params).topic.join("/"));
  return doc ? { title: `${doc.title} · DNA OS` } : {};
}

export default async function DeveloperTopicPage({ params }: PageProps) {
  const topic = (await params).topic.join("/");
  const doc = resolveDoc(topic);
  if (!doc) notFound();
  return <DocsArticle current={`${docsHome}/${topic}`} {...doc} />;
}

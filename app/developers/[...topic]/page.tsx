import Link from "next/link";
import { notFound } from "next/navigation";
import { CodeSample, DocsArticle, docLink, type DocSection } from "../DocsArticle";
import { categories, docsHome, queryExample, services, specExample } from "../docs-data";

import { integrationGuides } from "../integration-guides";

type Doc = { title: string; description: string; sections: DocSection[] };

const docs: Record<string, Doc> = {
  quickstart: {
    title: "เริ่มใช้งาน API",
    description: "ดูรายการคำสั่งก่อน แล้วลองอ่านข้อมูลด้วยบัญชีที่มีสิทธิ์",
    sections: [
      { id: "before-you-begin", title: "เตรียม URL และบัญชี", content: <p>ตั้ง <code>DNA_BASE_URL</code> เป็น URL ของระบบที่กำลังใช้งาน สำหรับเว็บนี้ใช้ <code>https://dnaos.dev</code> การอ่านข้อมูลต้องมี <Link className={docLink} href="/developers/authentication">API Token</Link> ของบัญชีที่มีสิทธิ์ API และมีขอบเขตข้อมูลองค์กร</p> },
      { id: "first-request", title: "ดูคำสั่งที่รองรับ", content: <><CodeSample>{specExample}</CodeSample><Link className={docLink} href="/api/v1/spec">เปิดผล JSON จาก API</Link></> },
      { id: "first-query", title: "ลองเรียกคำสั่งอ่าน", content: <><p>สำหรับระบบที่เปิด Query API แล้ว ให้ตั้ง <code>DNA_TOKEN</code> เป็น Production Token ของบัญชีที่มีสิทธิ์ ตัวอย่างนี้เรียก <code>debt.list</code> เพื่ออ่านรายการลูกหนี้ที่ยังเปิดอยู่ตามสิทธิ์ของบัญชี</p><CodeSample>{queryExample}</CodeSample></> },
      { id: "next", title: "ขั้นต่อไป", content: <p>ดู <Link className={docLink} href="/developers/api/query">รูปแบบคำขอและผลตอบกลับ</Link></p> },
    ],
  },
  authentication: {
    title: "บัญชีและ API Token",
    description: "ใช้บัญชี DNA OS เดิมและแยก Token สำหรับทดสอบออกจากสิทธิ์ใช้งานจริง",
    sections: [
      { id: "sandbox-token", title: "Sandbox Token", content: <>
        <p>สำหรับพรีวิวในเครื่อง ให้ล็อกอินด้วยบัญชี DNA OS เดิมแล้วสร้าง Sandbox Token อายุ 30 นาที ใช้ทดสอบการยืนยัน Token โดยไม่เรียกข้อมูลจริงหรือเครื่องประมวลผล</p>
        <p className="mt-2"><Link className={docLink} href="/developers/sandbox-token">เปิดหน้า Sandbox Token ในเครื่อง</Link></p>
      </> },
      { id: "create-token", title: "Production Token", content: <>
        <p>ใช้บัญชีเดิมที่มีสิทธิ์ผู้ดูแลสร้าง Token อีกชุดในหน้าจัดการเดิม เลือกขอบเขตตามงาน สำหรับคำสั่งอ่านให้ใช้ <code>read</code> การอนุญาตขึ้นกับสิทธิ์ของบัญชีและขอบเขตองค์กร</p>
        <p className="mt-2"><Link className={docLink} href="/admin/api-tokens">เปิดหน้าจัดการ Production Token</Link></p>
      </> },
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
      title: "คู่มือเชื่อมต่อ",
      description: "อ่านวิธีติดตั้ง ตั้งค่า และทดสอบการเชื่อมต่อกับผู้ให้บริการ แพลตฟอร์ม และระบบประมวลผลก่อนขอสิทธิ์",
      sections: categories.map((category) => ({
        id: `category-${category.id}`,
        title: category.name,
        content: <>
          {category.id === "channels" && <p className="mb-3 text-stone-600">
            DNA OS ใช้แพลตฟอร์มเหล่านี้รับข้อความและส่งการแจ้งเตือนผ่านช่องทางที่เปิดใช้ตามสิทธิ์ที่ได้รับ
            แต่ละคู่มือระบุว่าแพลตฟอร์มนั้นรองรับการรับหรือส่งอะไรบ้าง
          </p>}
          <ul className="space-y-1">{category.services.map((item) => (
            <li key={item.id}><Link className={docLink} href={`/developers/integrations/${item.id}`}>{item.name}</Link></li>
          ))}</ul>
        </>,
      })),
    };
  }

  if (!topic.startsWith("integrations/")) return undefined;
  const id = topic.slice("integrations/".length);
  const catalogEntry = services.find((item) => item.id === id);
  const service = categories.flatMap((category) => category.services).find((item) => item.id === id);
  const guide = Object.hasOwn(integrationGuides, id) ? integrationGuides[id] : undefined;
  if (!service || !guide) return undefined;

  return {
    title: service.name,
    description: service.description,
    sections: [
      { id: `service-${id}`, title: "เตรียมและติดตั้ง", content: <p>{guide.install}</p> },
      { id: "setup", title: "ตั้งค่า", content: <p>{guide.setup}</p> },
      ...(guide.records ? [{
        id: "records",
        title: "ข้อมูลและเอกสารที่ต้องบันทึก",
        content: <ul className="list-disc space-y-1 pl-5">{guide.records.map((record) => <li key={record}>{record}</li>)}</ul>,
      }] : []),
      ...(guide.implementation ? [{
        id: "implementation",
        title: "สิ่งที่มีในระบบตอนนี้",
        content: <p>{guide.implementation}</p>,
      }] : []),
      { id: id === "line" ? "webhook" : "test", title: "ทดสอบ", content: <p>{guide.test}</p> },
      { id: "access", title: "สิทธิ์และเปิดใช้งาน", content: <>
        <p>{guide.access ?? (guide.settings
          ? "ใช้บัญชี DNA OS เดิมและคีย์ที่องค์กรอนุญาตให้ใช้กับบริการนี้"
          : "ผู้ดูแลระบบเป็นผู้ตั้งค่าและอนุมัติการใช้บริการนี้")}</p>
        {guide.settings && <p className="mt-2"><Link className={docLink} href={guide.settings}>เปิดหน้าตั้งค่า</Link></p>}
      </> },
      ...(catalogEntry?.sourceUrl ? [{
        id: "provider-docs",
        title: "เอกสารผู้ให้บริการ",
        content: <a href={catalogEntry.sourceUrl} className={docLink} rel="noreferrer" target="_blank">{catalogEntry.sourceLabel}</a>,
      }] : []),
    ],
  };
}

type PageProps = { params: Promise<{ topic: string[] }> };

export function generateStaticParams() {
  return [...Object.keys(docs), "integrations", ...categories.flatMap(({ services }) => services.map(({ id }) => `integrations/${id}`))]
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

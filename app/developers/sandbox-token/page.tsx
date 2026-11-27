import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthedUser } from "@/core/auth/session";
import { DocsArticle, docLink } from "../DocsArticle";
import { SandboxTokenControls } from "./sandbox-token-controls";

const path = "/developers/sandbox-token";

export const dynamic = "force-dynamic";

export default async function SandboxTokenPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const authReady = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const account = authReady ? await getAuthedUser() : null;

  return <DocsArticle current={path} title="Sandbox Token"
    description="Token ทดสอบอายุ 30 นาที ใช้กับ Sandbox ในเครื่องด้วยบัญชี DNA OS เดิม"
    sections={[]}>
    <div className="mt-6">
      {!authReady
        ? <p role="status">เซิร์ฟเวอร์ในเครื่องยังไม่ได้ตั้งค่า Supabase Auth สำหรับยืนยันบัญชี DNA OS</p>
        : account
          ? <SandboxTokenControls />
          : <p><Link className={docLink} href={`/login?next=${encodeURIComponent(path)}`}>เข้าสู่ระบบด้วยบัญชี DNA OS</Link></p>}
    </div>
    <p className="mt-6"><Link className={docLink} href="/developers/authentication#create-token">ดูวิธีขอ Production Token</Link></p>
  </DocsArticle>;
}

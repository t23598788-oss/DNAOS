import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";

/** Saved character study; protected by the existing admin layout.
 * Isolated scripts animate locally; no business data or execution authority.
 */
export default async function AssistantGalleryPage() {
  const preview = await readFile(path.join(process.cwd(), "presentation/assets/assistant-crew/preview.html"), "utf8");
  return (
    <main className="min-h-screen bg-[#FDFBF8] p-4 text-stone-800">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h1 className="text-lg font-medium">พนักงานผู้ช่วย · 4 รูปแบบ</h1>
        <Link href="/admin/ui-gallery/visual-review" className="text-sm underline">กลับคลังภาพ UI</Link>
      </div>
      <p className="mb-3 text-sm text-stone-500">ต้นแบบบุคลิกและการขยับ · ยังไม่เชื่อมข้อมูลหรืองานจริง</p>
      <iframe title="ทดลองพนักงานผู้ช่วยสี่รูปแบบ" srcDoc={preview} sandbox="allow-scripts" className="h-[85dvh] w-full rounded-xl border border-stone-200" />
    </main>
  );
}

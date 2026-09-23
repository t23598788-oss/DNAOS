// หน้าจอ template login (static prototype — ไม่ผูก Supabase Auth; พื้นที่นี้เป็น dev/review surface)
import Link from "next/link";

export default function BusinessWorkspaceLoginPage() {
  return (
    <main className="min-h-screen bg-[#f5f6f8] px-5 py-10 text-slate-900">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 lg:grid-cols-[1.05fr_.95fr]">
        <section className="hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-lg font-bold text-slate-950">D</div>
              <div>
                <div className="text-xl font-semibold">DNA OS</div>
                <div className="text-sm text-slate-400">Business Workspace Template</div>
              </div>
            </div>
            <div className="mt-20 max-w-md">
              <p className="text-sm font-medium text-slate-400">พื้นที่ทำงานธุรกิจ</p>
              <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight">งาน เอกสาร ตาราง และการสื่อสาร อยู่ใน Workspace เดียว</h1>
              <p className="mt-5 text-base leading-7 text-slate-400">หน้าหลักเป็น DNA OS เครื่องมือภายนอกทำหน้าที่อยู่ภายในตามสิทธิ์และบริบทของงาน</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs text-slate-300">
            <div className="rounded-xl border border-white/10 p-3">เอกสาร</div>
            <div className="rounded-xl border border-white/10 p-3">ตารางงาน</div>
            <div className="rounded-xl border border-white/10 p-3">การสื่อสาร</div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10 lg:p-14">
          <div className="w-full max-w-md">
            <div className="lg:hidden">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-950 font-semibold text-white">D</div>
              <div className="mt-3 text-lg font-semibold">DNA OS</div>
            </div>
            <div className="mt-8 lg:mt-0">
              <h2 className="text-2xl font-semibold tracking-tight">เข้าสู่ Business Workspace</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">เข้าสู่ระบบเพื่อเปิดพื้นที่งาน เอกสาร ตารางงาน และข้อมูลที่ได้รับสิทธิ์</p>
            </div>

            <div className="mt-8 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">บัญชีผู้ใช้</span>
                <input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-900" placeholder="ชื่อผู้ใช้หรืออีเมล" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">รหัสผ่าน</span>
                <input type="password" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-slate-900" placeholder="รหัสผ่าน" />
              </label>
              <Link href="/business-workspace-template/overview" className="block rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-medium text-white hover:bg-slate-800">เข้าสู่ระบบ</Link>
            </div>

            <div className="my-6 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" /><span>หรือ</span><span className="h-px flex-1 bg-slate-200" /></div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">เข้าสู่ระบบด้วย LINE</button>
              <button className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">เข้าสู่ระบบด้วย Google</button>
            </div>
            <p className="mt-8 text-xs leading-5 text-slate-400">ต้นแบบหน้าจอเท่านั้น ยังไม่เชื่อมระบบยืนยันตัวตนจริง และไม่กระทบระบบ Login เดิม</p>
          </div>
        </section>
      </div>
    </main>
  );
}

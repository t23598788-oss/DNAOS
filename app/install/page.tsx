// วิธีติดตั้งแอป (PWA) — หน้าช่วยติดตั้งสาธารณะ (ไม่มีข้อมูลบัญชี/ความลับใด ๆ)
// สำหรับผู้ใช้ที่เปิดลิงก์แล้วต้องการเพิ่มลงหน้าจอโฮม. ทุกฟังก์ชันต้อง
// ออนไลน์ (ไม่มีโหมดออฟไลน์) และถ้าอุปกรณ์ติดตั้งไม่ได้ ใช้ผ่านเบราว์เซอร์
// ได้ครบทุกอย่าง. แจกเฉพาะตัวแอปนี้เท่านั้น — ไม่มีซอร์สโค้ด/ไฟล์ env/ความลับ.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ติดตั้งแอป | DNA OS",
  description: "วิธีติดตั้ง DNA OS เป็นแอป (PWA) บน Android, iPhone/iPad และเดสก์ท็อป — ทุกฟังก์ชันต้องออนไลน์",
  alternates: { canonical: "/install" },
  openGraph: {
    title: "ติดตั้งแอป | DNA OS",
    description: "วิธีติดตั้ง DNA OS เป็นแอป (PWA) บนทุกอุปกรณ์",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "ติดตั้งแอป | DNA OS",
    description: "วิธีติดตั้ง DNA OS เป็นแอป (PWA) บนทุกอุปกรณ์",
    images: ["/opengraph-image"],
  },
};

const STEPS: { device: string; how: string[] }[] = [
  {
    device: "Android — Chrome",
    how: [
      "เปิดลิงก์แอปนี้ใน Chrome แล้วล็อกอิน (ถ้าถาม)",
      "แตะเมนู ⋮ ขวาบน → «ติดตั้งแอป» หรือ «เพิ่มไปยังหน้าจอหลัก»",
      "ยืนยัน → ไอคอน DNA OS ขึ้นหน้าจอโฮม เปิดจากไอคอนเข้างานเดิมได้เลย",
    ],
  },
  {
    device: "iPhone / iPad — Safari",
    how: [
      "เปิดลิงก์ใน Safari (ไม่ใช่ Chrome) แล้วล็อกอิน",
      "แตะปุ่มแชร์ [↑] → «เพิ่มไปยังหน้าจอโฮม»",
      "ตั้งชื่อ → เพิ่ม → เปิดจากไอคอน",
    ],
  },
  {
    device: "Windows / Linux — Chrome หรือ Edge",
    how: [
      "เปิดลิงก์แล้วล็อกอิน",
      "ดูไอคอนติดตั้ง (จอภาพ+) ทางขวาของแถบที่อยู่ หรือเมนู ⋮ → «ติดตั้ง DNA OS»",
      "ยืนยัน → เปิดจากเมนูเริ่ม/เดสก์ท็อป",
    ],
  },
  {
    device: "macOS — Safari / Chrome",
    how: [
      "Safari: ปุ่มแชร์ → «เพิ่มไปยัง Dock»",
      "Chrome: ไอคอนติดตั้งในแถบที่อยู่ หรือเมนู ⋮ → «ติดตั้งแอป»",
    ],
  },
];

export default function InstallHelpPage() {
  return (
    <main className="min-h-screen bg-[#F0EBE5] flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-[#E9E1D6] bg-[#FDFBF8] p-8 shadow-sm">
        <h1 className="text-lg font-bold text-stone-800">ติดตั้ง DNAOS ลงเครื่อง</h1>
        <p className="mt-1 text-xs text-stone-500">
          ติดตั้งฟรีจากเบราว์เซอร์ของคุณเอง (PWA) — ไม่ต้องโหลดไฟล์ติดตั้ง และไม่มีส่วนของโค้ดเซิร์ฟเวอร์หรือความลับใด ๆ แจกจ่าย
        </p>

        <ol className="mt-5 space-y-4">
          {STEPS.map((s) => (
            <li key={s.device} className="rounded-xl border border-[#E9E1D6] p-4">
              <p className="text-sm font-semibold text-stone-800">{s.device}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-stone-600">
                {s.how.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
            </li>
          ))}
        </ol>

        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
          <p>• ติดตั้งไม่ได้บนอุปกรณ์ไหน? <b>ใช้ผ่านเบราว์เซอร์ได้ครบเหมือนเดิม</b> — ฟังก์ชันไม่ได้หายไป</p>
          <p>• ทุกฟังก์ชันต้องออนไลน์ (ระบบไม่มีโหมดออฟไลน์)</p>
          <p>• เมื่อมีเวอร์ชันใหม่ แอปจะขึ้นแจ้งเตือน «มีเวอร์ชันใหม่» ให้คุณกดรีเฟรชเอง — งานที่พิมพ์ค้างจะไม่ถูกเตะออกโดยอัตโนมัติ</p>
          <p>• ออกจากระบบหรือสลับบัญชีแล้ว ข้อมูลบัญชีก่อนหน้าจะไม่ถูกเก็บไว้แสดงซ้ำ</p>
        </div>

        <div className="mt-5 rounded-xl border border-[#E9E1D6] p-4">
          <p className="text-sm font-semibold text-stone-800">Device Connector — งานที่ต้องใช้เครื่องของคุณ</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">
            สำหรับงานที่ต้องแตะเครื่องจริง (เช่น อ่านเครื่องพิมพ์) ติดตั้ง connector ของระบบ — <b>ไม่ต้อง clone repo ไม่ต้อง npm</b> ต้องมีแค่ Node 18+:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-stone-600">
            <li>ให้ผู้ดูแลสร้างโค้ดจับคู่ที่หน้า <a className="underline" href="/admin/devices" target="_blank" rel="noreferrer">/admin/devices</a> (โค้ดอายุ10นาที ใช้1ครั้ง)</li>
            <li>ดาวน์โหลดไฟล์ <code className="font-mono">dnaos-device.mjs</code> แล้วรัน:{" "}
              <code className="font-mono">node dnaos-device.mjs pair &lt;โค้ด&gt; --server https://&lt;โดเมนแอป&gt;</code></li>
            <li>Token ถูกเก็บใน Keychain (macOS) / DPAPI (Windows) / libsecret (Linux) — ไม่ใช่ไฟล์ข้อความ</li>
            <li>เปิด service ประจำเครื่อง: <code className="font-mono">node dnaos-device.mjs install</code> (ลง LaunchAgent/schtasks/systemd-user ตำแหน่งมาตรฐาน) · ถอน: <code className="font-mono">uninstall</code> + กดเพิกถอนที่หน้า /admin/devices</li>
          </ol>
          <p className="mt-2 text-[11px] text-stone-400">
            สถานะรองรับจริง: macOS ทดสอบแล้ว (selftest + install/uninstall round-trip) · Windows/Linux มีโค้ดแต่ยังไม่มีเครื่องทดสอบ = UNVERIFIED ·
            ทุกคำสั่งที่ connector รันเป็น allowlist เท่านั้น (ไม่มี shell อิสระ) · ดูช่องทาง×ความสามารถเต็มที่หน้า /admin/devices
          </p>
        </div>

        <div className="mt-5 flex items-center justify-between text-xs">
          <a href="/login" className="text-[#1e6fa8] hover:underline">
            ← กลับไปหน้าเข้าสู่ระบบ
          </a>
          <span className="text-stone-400">DNA OS · PWA</span>
        </div>
      </div>
    </main>
  );
}
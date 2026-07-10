import PortalShell from "@/components/portal/PortalShell";
import constitution from "@/registry/CONSTITUTION.json";
import CopyButton from "@/components/landing/CopyButton";
import { Terminal } from "lucide-react";

export default function DownloadCenterPage() {
  const commands = Object.entries(constitution.commands);
  return (
    <PortalShell portalId="download_center">
      <div className="max-w-2xl mx-auto">
        <p className="text-center text-xs text-stone-500 mb-6">
          ยังไม่มีไฟล์ดาวน์โหลด (เช่น แอปหรือแพ็กเกจ) ที่กำหนดไว้จริง — สิ่งที่มีอยู่จริงตอนนี้คือชุดคำสั่งของระบบ (CLI) ด้านล่าง
        </p>
        <div className="space-y-2">
          {commands.map(([key, desc]) => {
            const [cmd, ...rest] = (desc as string).split(' — ');
            return (
              <div key={key} className="bg-stone-950 border border-stone-800 rounded-xl p-4 flex items-start gap-3">
                <Terminal className="w-4 h-4 text-stone-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <code className="text-sm font-mono text-emerald-400">{cmd}</code>
                  {rest.length > 0 && <p className="mt-1 text-xs text-stone-500">{rest.join(' — ')}</p>}
                </div>
                <CopyButton text={cmd} />
              </div>
            );
          })}
        </div>
      </div>
    </PortalShell>
  );
}

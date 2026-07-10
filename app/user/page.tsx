import PortalShell from "@/components/portal/PortalShell";
import existence from "@/registry/existence.json";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import permissions from "@/registry/permissions.json";
import type { AppRole } from "@/core/auth/session";
import {
  Eye, MapPin, Mic, Camera, MessageSquare, CreditCard, Printer, Radio,
  Database, Bot, FolderOpen, Terminal, Globe, Calendar, Cpu, Wifi, Move3d,
  CheckCircle, AlertTriangle, XCircle,
} from "lucide-react";

const USER_ROLES = permissions.route_access.find(r => r.prefix === "/user")!.roles as AppRole[];

const capabilityIcon: { [key: string]: React.ElementType } = {
  vision: Eye, gps: MapPin, voice: Mic, camera: Camera, messaging: MessageSquare,
  payment: CreditCard, printer: Printer, sensor: Radio, database: Database,
  ai_text: Bot, file_system: FolderOpen, terminal: Terminal, browser: Globe,
  calendar: Calendar, plc: Cpu, mqtt: Wifi, robot_arm: Move3d,
};

const statusStyle: { [key: string]: { icon: React.ElementType; className: string } } = {
  available: { icon: CheckCircle, className: "text-emerald-400 border-emerald-800 bg-emerald-950/40" },
  partial: { icon: AlertTriangle, className: "text-amber-400 border-amber-800 bg-amber-950/40" },
  not_available: { icon: XCircle, className: "text-stone-500 border-stone-800 bg-stone-950/40" },
};

export default async function UserPortalPage() {
  await requireAuthPage("/user", USER_ROLES);
  const capabilities = Object.entries(existence.capabilities);
  return (
    <PortalShell portalId="user_portal">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {capabilities.map(([key, cap]) => {
          const Icon = capabilityIcon[key] || Bot;
          const style = statusStyle[cap.status] || statusStyle.not_available;
          const StatusIcon = style.icon;
          return (
            <div key={key} className="bg-stone-950 border border-stone-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-stone-400" />
                  <span className="text-sm text-white capitalize">{key.replace(/_/g, ' ')}</span>
                </div>
                <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${style.className}`}>
                  <StatusIcon className="w-3 h-3" />
                </span>
              </div>
              {cap.used_by && cap.used_by.length > 0 && (
                <p className="mt-2 text-xs font-mono text-stone-600 truncate">{cap.used_by.join(', ')}</p>
              )}
            </div>
          );
        })}
      </div>
    </PortalShell>
  );
}

import type { Command, CommandResult } from "@/types/command";
import { getJobs } from "@/lib/supabase/queries";

export async function handleJobs(command: Command): Promise<CommandResult> {
  switch (command.action) {
    case "job.list": {
      const data = await getJobs();
      return { ok: true, command, data };
    }
    case "job.active": {
      const data = await getJobs("IN_PROGRESS");
      return { ok: true, command, data };
    }
    default:
      return { ok: false, command, error: `job: ไม่รองรับ ${command.action}` };
  }
}

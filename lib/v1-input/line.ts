import type { Command, CommandResult } from "@/types/command";

export async function handleLine(command: Command): Promise<CommandResult> {
  return { ok: false, command, error: "LINE commands ใช้ผ่าน computer.launch — พิมพ์ 'เปิด LINE'" };
}

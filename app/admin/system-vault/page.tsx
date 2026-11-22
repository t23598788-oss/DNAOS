import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import ControlBoard from "../control-board/ControlBoard";

export default async function SystemVaultPage() {
  await requireAuthPage("/admin/system-vault", ADMIN_TIER);
  return <ControlBoard />;
}

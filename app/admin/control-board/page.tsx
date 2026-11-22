import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";
import OperatorBoard from "./OperatorBoard";

export default async function OperatorBoardPage() {
  await requireAuthPage("/admin/control-board", ADMIN_TIER);
  return <OperatorBoard />;
}

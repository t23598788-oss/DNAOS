import { requireAuthPage } from "@/core/auth/requireAuthPage";
import ConnectionsCatalogClient from "./ConnectionsCatalogClient";

export default async function AccountConnectionsPage() {
  const user = await requireAuthPage("/account/connections");
  return <ConnectionsCatalogClient userEmail={user.email} />;
}

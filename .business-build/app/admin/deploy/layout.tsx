import { requirePlatformOperatorPage } from "@/core/auth/requireAuthPage";

export default async function DeployLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformOperatorPage("/admin/deploy");
  return <>{children}</>;
}

import { requirePlatformOperatorPage } from "@/core/auth/requireAuthPage";

export default async function DbdLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformOperatorPage("/admin/dbd");
  return <>{children}</>;
}

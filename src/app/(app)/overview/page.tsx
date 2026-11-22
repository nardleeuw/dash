import { PageHeader } from "@/components/app/page-header";
import { getWorkspace } from "@/server/auth";
import { getDictionary } from "@/i18n/server";

export default async function OverviewPage() {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  return <PageHeader title={t.nav.overview} description={ws.org.name} />;
}

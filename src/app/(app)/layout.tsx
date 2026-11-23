import { Sidebar } from "@/components/app/sidebar";
import { MockBanner } from "@/components/app/mock-banner";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { mockProviders } from "@/server/providers/mode";
import { hasPaidAccess, paywallEnabled } from "@/server/usage";
import { PaywallBanner } from "@/components/app/paywall-banner";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ws = await getWorkspace();
  const supabase = await createClient();
  const { count: inboxCount } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ws.org.id)
    .eq("needs_attention", true);
  const locked = paywallEnabled() && !(await hasPaidAccess(ws.org.id));

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        orgId={ws.org.id}
        orgName={ws.org.name}
        role={ws.role}
        memberships={ws.memberships}
        userName={ws.user.fullName ?? ""}
        userEmail={ws.user.email}
        inboxCount={inboxCount ?? 0}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {locked && <PaywallBanner />}
        <MockBanner providers={mockProviders()} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

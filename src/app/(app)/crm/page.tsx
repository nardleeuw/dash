import { PageHeader } from "@/components/app/page-header";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { Pipeline } from "./pipeline";
import { TaskList } from "./task-list";

export const metadata = { title: "CRM" };

const COLUMNS = ["qualified", "approved", "contacted", "replied", "interested", "meeting_booked", "customer", "not_interested"];

export default async function CrmPage({ searchParams }: PageProps<"/crm">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const mine = sp.mine === "1";
  const supabase = await createClient();
  let q = supabase.from("businesses").select("id, name, city, lead_status, lead_score, assigned_to, recommended_service").eq("org_id", ws.org.id).in("lead_status", COLUMNS).order("lead_score", { ascending: false, nullsFirst: false }).limit(800);
  if (mine) q = q.eq("assigned_to", ws.user.id);
  const [{ data: leads }, { data: tasks }, { data: members }] = await Promise.all([
    q,
    supabase.from("tasks").select("id, title, description, due_at, status, assignee_id, business_id, businesses(name)").eq("org_id", ws.org.id).eq("status", "open").order("due_at", { ascending: true, nullsFirst: false }).limit(200),
    supabase.from("organization_members").select("user_id, users!organization_members_user_id_fkey(full_name, email)").eq("org_id", ws.org.id),
  ]);
  const memberList = (members ?? []).map((m) => ({ id: m.user_id as string, name: (m.users as unknown as { full_name: string | null; email: string })?.full_name || (m.users as unknown as { email: string })?.email }));
  return (
    <>
      <PageHeader title={t.crm.title} description={t.crm.subtitle} />
      <div className="space-y-8">
        <Pipeline columns={COLUMNS} leads={(leads ?? []) as never} canWrite={ws.role !== "viewer"} mine={mine} />
        <TaskList
          tasks={(tasks ?? []).map((x) => ({ ...x, business: (x.businesses as unknown as { name: string } | null)?.name ?? null })) as never}
          members={memberList}
          currentUserId={ws.user.id}
          canWrite={ws.role !== "viewer"}
        />
      </div>
    </>
  );
}

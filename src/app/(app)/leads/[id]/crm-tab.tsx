import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/server/supabase/server";
import { getWorkspace } from "@/server/auth";
import { getDictionary } from "@/i18n/server";
import { TaskList } from "@/app/(app)/crm/task-list";
import { Notes } from "./notes";

export async function ProfileCrmTrigger() {
  const t = await getDictionary();
  return <TabsTrigger value="crm">{t.leads.profile.notes} & {t.leads.profile.tasks.toLowerCase()}</TabsTrigger>;
}

export async function ProfileCrmTab({ businessId }: { businessId: string }) {
  const ws = await getWorkspace();
  const supabase = await createClient();
  const [{ data: notes }, { data: tasks }, { data: members }] = await Promise.all([
    supabase.from("notes").select("id, body, created_at, created_by, users!organization_members_user_id_fkey(full_name, email)").eq("business_id", businessId).order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, title, description, due_at, status, assignee_id, business_id").eq("business_id", businessId).eq("status", "open").order("due_at"),
    supabase.from("organization_members").select("user_id, users!organization_members_user_id_fkey(full_name, email)").eq("org_id", ws.org.id),
  ]);
  const memberList = (members ?? []).map((m) => ({ id: m.user_id as string, name: (m.users as unknown as { full_name: string | null; email: string })?.full_name || (m.users as unknown as { email: string })?.email }));
  return (
    <TabsContent value="crm" className="grid gap-6 xl:grid-cols-2">
      <Notes
        businessId={businessId}
        notes={(notes ?? []).map((n) => ({ id: n.id, body: n.body, created_at: n.created_at, author: (n.users as unknown as { full_name: string | null; email: string } | null)?.full_name ?? (n.users as unknown as { email: string } | null)?.email ?? "" }))}
        canWrite={ws.role !== "viewer"}
      />
      <TaskList tasks={(tasks ?? []).map((x) => ({ ...x, business: null })) as never} members={memberList} currentUserId={ws.user.id} canWrite={ws.role !== "viewer"} businessId={businessId} />
    </TabsContent>
  );
}

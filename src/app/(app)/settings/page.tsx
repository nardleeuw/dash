import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { getWorkspace, hasMinRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { readComplianceSettings } from "@/server/compliance/eligibility";
import { OrganizationForm, TeamPanel, CompliancePanel, ProfileForm } from "./forms";

export const metadata = { title: "Instellingen" };
const TABS = ["organization", "team", "compliance", "audit", "profile"] as const;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(String(sp.tab)) ? String(sp.tab) : "organization";
  const supabase = await createClient();
  const s = t.settings;

  let body: React.ReactNode;
  if (tab === "organization") {
    const { data: org } = await supabase.from("organizations").select("name, legal_name, kvk_number, postal_address, privacy_policy_url, locale").eq("id", ws.org.id).single();
    body = <OrganizationForm initial={org!} canEdit={hasMinRole(ws.role, "admin")} />;
  } else if (tab === "team") {
    const [{ data: members }, { data: invitations }] = await Promise.all([
      supabase.from("organization_members").select("id, role, user_id, users!organization_members_user_id_fkey(full_name, email)").eq("org_id", ws.org.id).order("created_at"),
      hasMinRole(ws.role, "admin") ? supabase.from("organization_invitations").select("id, email, role, expires_at").eq("org_id", ws.org.id).is("accepted_at", null).is("revoked_at", null) : Promise.resolve({ data: [] }),
    ]);
    body = (
      <TeamPanel
        members={(members ?? []).map((m) => ({ id: m.id, role: m.role, userId: m.user_id, name: (m.users as unknown as { full_name: string | null; email: string })?.full_name ?? "", email: (m.users as unknown as { email: string })?.email ?? "" }))}
        invitations={(invitations ?? []) as { id: string; email: string; role: string; expires_at: string }[]}
        currentUserId={ws.user.id}
        canManage={hasMinRole(ws.role, "admin")}
      />
    );
  } else if (tab === "compliance") {
    const [{ data: notices }, { data: permissions }, { data: suppression }, { data: requests }] = await Promise.all([
      supabase.from("privacy_notices").select("language, email_footer, url, version").eq("org_id", ws.org.id).eq("is_active", true),
      supabase.from("email_permissions").select("id, email, basis, recipient_category, purpose, source, obtained_at, expires_at, revoked_at, evidence_file_path").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(200),
      supabase.from("suppression_records").select("id, email, domain, reason, source, created_at").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(300),
      supabase.from("data_subject_requests").select("id, email, type, status, received_at, due_at").eq("org_id", ws.org.id).order("received_at", { ascending: false }).limit(100),
    ]);
    const rules = readComplianceSettings(ws.org.settings);
    body = (
      <CompliancePanel
        rules={{ accepted_bases: rules.acceptedBases, require_verified_email: rules.requireVerifiedEmail }}
        notices={(notices ?? []) as { language: "nl" | "en"; email_footer: string; url: string | null }[]}
        permissions={permissions ?? []}
        suppression={suppression ?? []}
        requests={requests ?? []}
        role={ws.role}
      />
    );
  } else if (tab === "audit") {
    const { data: logs } = hasMinRole(ws.role, "admin")
      ? await supabase.from("audit_logs").select("id, action, entity_type, entity_id, metadata, created_at, actor_user_id, users(full_name, email)").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(200)
      : { data: [] };
    body = (
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">{t.common.created}</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">{t.common.actions}</th><th className="px-3 py-2">Entity</th><th className="px-3 py-2">Details</th></tr></thead>
          <tbody>
            {(logs ?? []).map((l) => (
              <tr key={l.id} className="border-t align-top">
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{new Date(l.created_at).toLocaleString(t.meta.dateLocale)}</td>
                <td className="px-3 py-2">{(l.users as unknown as { full_name: string | null; email: string } | null)?.full_name ?? (l.users as unknown as { email: string } | null)?.email ?? "system"}</td>
                <td className="px-3 py-2">{l.action}</td>
                <td className="px-3 py-2">{l.entity_type}</td>
                <td className="max-w-md truncate px-3 py-2 font-mono text-xs text-muted-foreground">{JSON.stringify(l.metadata)}</td>
              </tr>
            ))}
            {(logs ?? []).length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">—</td></tr>}
          </tbody>
        </table>
      </div>
    );
  } else {
    body = <ProfileForm initial={{ full_name: ws.user.fullName ?? "", locale: ws.user.locale }} />;
  }

  return (
    <>
      <PageHeader title={s.title} description={ws.org.name} />
      <div className="mb-5 inline-flex h-9 items-center rounded-lg bg-secondary p-1">
        {TABS.map((k) => (
          <Link key={k} href={`/settings?tab=${k}`} className={`inline-flex h-full items-center rounded-md px-3 text-sm font-medium ${tab === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {(s.tabs as Record<string, string>)[k]}
          </Link>
        ))}
      </div>
      {body}
    </>
  );
}

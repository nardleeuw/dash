import { CheckCircle2, CircleSlash, FlaskConical, Mail } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getWorkspace, hasMinRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { providerStatusList } from "@/server/providers/mode";
import { oauthConfigured } from "@/server/sending/providers/oauth";
import { env, isProduction } from "@/server/env";
import { inngestEnabled } from "@/server/jobs/client";
import { AccountsManager } from "./accounts-manager";

export const metadata = { title: "Integraties" };

const LABELS: Record<string, { name: string; use: { nl: string; en: string } }> = {
  kvk: { name: "KVK Handelsregister", use: { nl: "Bedrijfsgegevens, vestigingen, SBI", en: "Company data, establishments, SBI" } },
  google_places: { name: "Google Places", use: { nl: "Bedrijven zoeken, categorieën, telefoon", en: "Business search, categories, phone" } },
  osm: { name: "OpenStreetMap", use: { nl: "Bedrijven per branche en gebied", en: "Businesses by industry and area" } },
  pdok: { name: "PDOK Locatieserver", use: { nl: "Plaatsen, gemeenten, postcodes", en: "Places, municipalities, postcodes" } },
  hunter: { name: "Hunter.io", use: { nl: "E-mailadressen vinden en verifiëren", en: "Find and verify email addresses" } },
  openai: { name: "OpenAI", use: { nl: "Onderzoek, scoring, e-mails, reacties", en: "Research, scoring, emails, replies" } },
  pagespeed: { name: "PageSpeed Insights", use: { nl: "Snelheid en mobiel (optioneel)", en: "Speed and mobile (optional)" } },
  stripe: { name: "Stripe", use: { nl: "Abonnementen en credits", en: "Subscriptions and credits" } },
};

export default async function IntegrationsPage({ searchParams }: PageProps<"/integrations">) {
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: accounts } = await supabase.from("email_accounts").select("id, provider, email_address, display_name, status, daily_limit, hourly_limit, min_delay_seconds, last_error, last_sent_at, is_mock, imap_host").eq("org_id", ws.org.id).order("created_at");
  const lang = t.meta.locale as "nl" | "en";
  const i = t.integrations;
  const statuses = providerStatusList();
  const kvkTest = /\/test\//.test(env().KVK_BASE);

  return (
    <>
      <PageHeader title={i.title} description={i.subtitle} />
      {sp.connected && <Alert variant="success" className="mb-4"><CheckCircle2 /><AlertDescription className="text-foreground">{i.connected}</AlertDescription></Alert>}
      {typeof sp.error === "string" && <Alert variant="destructive" className="mb-4"><CircleSlash /><AlertDescription className="text-foreground">OAuth: {sp.error}</AlertDescription></Alert>}
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader><CardTitle>{i.providers}</CardTitle></CardHeader>
          <CardContent className="divide-y pt-2">
            {statuses.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">{LABELS[s.key].name}</p>
                  <p className="text-xs text-muted-foreground">{LABELS[s.key].use[lang]}</p>
                </div>
                {s.mode === "live" ? (
                  <Badge variant={s.key === "kvk" && kvkTest ? "secondary" : "success"}>{s.key === "kvk" && kvkTest ? t.discover.status.test : t.discover.status.live}</Badge>
                ) : s.mode === "mock" ? (
                  <Badge variant="mock"><FlaskConical />{t.discover.status.mock}</Badge>
                ) : (
                  <Badge variant="outline">{t.discover.status.disabled}</Badge>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">Inngest</p>
                <p className="text-xs text-muted-foreground">{lang === "nl" ? "Achtergrondtaken (lokaal: ingebouwde scheduler)" : "Background jobs (locally: built-in scheduler)"}</p>
              </div>
              <Badge variant={inngestEnabled() ? "success" : "secondary"}>{inngestEnabled() ? "Live" : lang === "nl" ? "Ingebouwd" : "Built-in"}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Mail className="size-4" />{i.emailAccounts}</CardTitle>
            <CardDescription>{i.deliverability} {t.campaigns.noRotation}</CardDescription>
          </CardHeader>
          <CardContent className="pt-3">
            <AccountsManager
              accounts={(accounts ?? []) as never}
              canManage={hasMinRole(ws.role, "admin")}
              gmail={oauthConfigured("google")}
              microsoft={oauthConfigured("microsoft")}
              allowDemo={!isProduction()}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { getWorkspace } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { getDictionary } from "@/i18n/server";
import { formatDate } from "@/i18n/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmailEditor } from "./editor";

export default async function EmailDetailPage({ params }: PageProps<"/emails/[id]">) {
  const { id } = await params;
  const [ws, t] = await Promise.all([getWorkspace(), getDictionary()]);
  const supabase = await createClient();
  const { data: e } = await supabase.from("generated_emails").select("*, businesses(id, name, city, website_url)").eq("id", id).eq("org_id", ws.org.id).maybeSingle();
  if (!e) notFound();
  const [{ data: contacts }, { data: revisions }] = await Promise.all([
    supabase.from("contacts").select("id, email, full_name, email_type, email_verification").eq("business_id", e.business_id).not("email", "is", null),
    supabase.from("generated_email_revisions").select("id, version, subject, body, reason, created_at").eq("generated_email_id", id).order("version", { ascending: false }).limit(10),
  ]);
  const ed = t.emails.editor;
  const lang = t.meta.locale as "nl" | "en";
  const fc = (e.fact_check ?? {}) as { passed?: boolean; issues?: { severity: string; code: string; message: string }[]; injection?: boolean; edited?: boolean };
  const reasons = (e.compliance_reasons ?? []) as { code: string; severity: string; nl: string; en: string }[];
  const evidence = (e.personalization_evidence ?? []) as { claim: string; evidence: string; source: string; supported: boolean }[];
  const biz = e.businesses as { id: string; name: string; city: string | null; website_url: string | null };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/emails" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t.emails.title}</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">{biz.name}</h1>
          <Badge variant={e.review_status === "approved" ? "success" : e.review_status === "rejected" ? "outline" : "warning"}>{(t.emails.reviewStatus as Record<string, string>)[e.review_status]}</Badge>
          {e.compliance_status === "eligible" ? <Badge variant="success"><ShieldCheck />{t.emails.compliance.eligible}</Badge> : e.compliance_status === "blocked" ? <Badge variant="destructive"><ShieldAlert />{t.emails.compliance.blocked}</Badge> : null}
          {e.is_mock && <Badge variant="mock">{t.mock.label}</Badge>}
          {e.sequence_step > 0 && <Badge variant="secondary">Follow-up {e.sequence_step}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href={`/leads/${biz.id}?tab=research`} className="hover:text-foreground">{biz.city ?? ""} · {t.leads.profile.research} →</Link>
          {e.model && <> · {e.model}</>} · v{e.version}
        </p>
      </div>

      {e.is_mock && <Alert variant="info"><AlertTriangle /><AlertDescription className="text-foreground">{ed.mockNote}</AlertDescription></Alert>}
      {fc.injection && <Alert variant="warning"><ShieldAlert /><AlertDescription className="text-foreground">{ed.injection}</AlertDescription></Alert>}

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <EmailEditor
          id={e.id}
          subject={e.subject ?? ""}
          body={e.body ?? ""}
          altSubject={e.alt_subject}
          altBody={e.alt_body}
          contactId={e.contact_id}
          contacts={(contacts ?? []).map((c) => ({ id: c.id, label: `${c.email}${c.full_name ? ` · ${c.full_name}` : ""}`, verification: c.email_verification }))}
          canWrite={ws.role !== "viewer"}
          generationStatus={e.generation_status}
          reviewStatus={e.review_status}
        />

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t.emails.columns.compliance}</CardTitle></CardHeader>
            <CardContent className="space-y-2 pt-3 text-sm">
              {reasons.length === 0 && e.compliance_status === "eligible" && <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" />{t.emails.compliance.eligible}</p>}
              {reasons.map((r) => (
                <p key={r.code} className="flex items-start gap-2">
                  {r.severity === "block" ? <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[oklch(0.6_0.14_65)]" />}
                  <span>{r[lang]}</span>
                </p>
              ))}
              {reasons.some((r) => r.code === "no_legal_basis") && (
                <Link href="/settings?tab=compliance" className="block pt-1 text-sm font-medium text-primary hover:underline">{lang === "nl" ? "Grondslag vastleggen →" : "Record a legal basis →"}</Link>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{ed.factCheck}</CardTitle>
              <CardDescription>{fc.passed ? ed.factPassed : ed.factFailed}{fc.edited ? ` · ${ed.edited}` : ""}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 pt-3 text-sm">
              {(fc.issues ?? []).map((i, n) => (
                <p key={n} className="flex items-start gap-2">
                  {i.severity === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[oklch(0.6_0.14_65)]" />}
                  <span>{i.message}</span>
                </p>
              ))}
              {fc.passed && (fc.issues ?? []).length === 0 && <p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" />{ed.factPassed}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{ed.evidence}</CardTitle></CardHeader>
            <CardContent className="space-y-3 pt-3">
              {evidence.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
              {evidence.map((x, i) => (
                <div key={i} className="text-sm">
                  <p className="flex items-center gap-2">{x.claim} <Badge variant={x.supported ? "success" : "destructive"}>{x.supported ? ed.supported : ed.unsupported}</Badge></p>
                  <p className="mt-0.5 text-xs text-muted-foreground">“{x.evidence}” · {x.source}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {(e.opportunity || e.research_summary) && (
            <Card>
              <CardHeader><CardTitle>{ed.research}</CardTitle></CardHeader>
              <CardContent className="space-y-2 pt-3 text-sm">
                {e.opportunity && <p><span className="text-muted-foreground">{ed.opportunity}:</span> <span className="font-medium">{(e.opportunity as { title?: string }).title}</span></p>}
                {e.research_summary && <p className="text-muted-foreground">{e.research_summary}</p>}
              </CardContent>
            </Card>
          )}

          {(revisions ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle>{ed.revisions}</CardTitle></CardHeader>
              <CardContent className="space-y-3 pt-3">
                {(revisions ?? []).map((r) => (
                  <details key={r.id} className="rounded-md border p-2 text-sm">
                    <summary className="cursor-pointer">v{r.version} · {r.reason} · {formatDate(r.created_at, t.meta.dateLocale, true)}</summary>
                    <p className="mt-2 font-medium">{r.subject}</p>
                    <pre className="mt-1 font-sans text-xs whitespace-pre-wrap text-muted-foreground">{r.body}</pre>
                  </details>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

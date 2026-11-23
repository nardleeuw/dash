"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Download, Loader2, Plus, Save, ShieldX, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { formatDate } from "@/i18n/format";
import {
  addPermissionAction, addSuppressionAction, createSubjectRequestAction, inviteMemberAction, processSubjectRequestAction,
  removeMemberAction, removeSuppressionAction, revokeInvitationAction, revokePermissionAction, savePrivacyNoticeAction,
  setMemberRoleAction, updateComplianceRulesAction, updateOrganizationAction, updateProfileAction,
} from "./actions";

const RANK: Record<string, number> = { owner: 50, admin: 40, manager: 30, sales_rep: 20, viewer: 10 };

function useDone() {
  const t = useT();
  const router = useRouter();
  return (r: { ok: boolean; error?: string }, msg = t.common.saved) => {
    if (r.ok) { toast.success(msg); router.refresh(); }
    else toast.error((t.common.errors as Record<string, string>)[r.error ?? ""] ?? (r.error === "owner_rule" ? (t.meta.locale === "nl" ? "Een werkruimte heeft altijd minstens één eigenaar." : "A workspace always needs at least one owner.") : t.common.errors.unexpected));
  };
}

export function OrganizationForm({ initial, canEdit }: { initial: { name: string; legal_name: string | null; kvk_number: string | null; postal_address: string | null; privacy_policy_url: string | null; locale: string }; canEdit: boolean }) {
  const t = useT();
  const s = t.settings;
  const done = useDone();
  const [f, setF] = useState({ ...initial, legal_name: initial.legal_name ?? "", kvk_number: initial.kvk_number ?? "", postal_address: initial.postal_address ?? "", privacy_policy_url: initial.privacy_policy_url ?? "" });
  const [pending, start] = useTransition();
  const field = (k: keyof typeof f, label: string) => (
    <div className="space-y-1.5"><Label htmlFor={k}>{label}</Label><Input id={k} value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} disabled={!canEdit} /></div>
  );
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>{s.tabs.organization}</CardTitle><CardDescription>{s.identityHint}</CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {field("name", s.orgName)}
        {field("legal_name", s.legalName)}
        {field("kvk_number", s.kvkNumber)}
        {field("postal_address", s.postalAddress)}
        <div className="space-y-1.5">
          <Label>{s.language}</Label>
          <Select value={f.locale} onValueChange={(v) => setF({ ...f, locale: v })} disabled={!canEdit}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="nl">Nederlands</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
          </Select>
        </div>
        {canEdit && <div className="md:col-span-2"><Button disabled={pending} onClick={() => start(async () => done(await updateOrganizationAction(f)))}>{pending ? <Loader2 className="animate-spin" /> : <Save />}{t.common.save}</Button></div>}
      </CardContent>
    </Card>
  );
}

export function ProfileForm({ initial }: { initial: { full_name: string; locale: string } }) {
  const t = useT();
  const done = useDone();
  const [f, setF] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <Card className="max-w-md">
      <CardContent className="space-y-4">
        <div className="space-y-1.5"><Label>{t.auth.fullName}</Label><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
        <div className="space-y-1.5">
          <Label>{t.nav.language}</Label>
          <Select value={f.locale} onValueChange={(v) => setF({ ...f, locale: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nl">Nederlands</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select>
        </div>
        <Button disabled={pending} onClick={() => start(async () => done(await updateProfileAction(f)))}><Save />{t.common.save}</Button>
      </CardContent>
    </Card>
  );
}

export function TeamPanel({ members, invitations, currentUserId, canManage }: { members: { id: string; role: string; userId: string; name: string; email: string }[]; invitations: { id: string; email: string; role: string; expires_at: string }[]; currentUserId: string; canManage: boolean }) {
  const t = useT();
  const tm = t.settings.team;
  const done = useDone();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("sales_rep");
  const [link, setLink] = useState<string | null>(null);
  const roles = t.roles as Record<string, string>;
  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader><CardTitle>{tm.members}</CardTitle></CardHeader>
        <CardContent className="divide-y pt-2">
          {members.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div><p className="text-sm font-medium">{m.name || m.email}</p><p className="text-xs text-muted-foreground">{m.email}</p></div>
              <div className="flex items-center gap-2">
                {canManage ? (
                  <Select value={m.role} onValueChange={(v) => start(async () => done(await setMemberRoleAction(m.id, v)))}>
                    <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(roles).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <Badge variant="secondary">{roles[m.role]}</Badge>}
                {(canManage || m.userId === currentUserId) && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => done(await removeMemberAction(m.id)))}>
                    {m.userId === currentUserId ? tm.leave : tm.removeMember}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {canManage && (
        <Card>
          <CardHeader><CardTitle>{tm.invite}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input type="email" placeholder={tm.email} value={email} onChange={(e) => setEmail(e.target.value)} />
            <Select value={role} onValueChange={setRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(roles).filter(([k]) => k !== "owner").map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
            <Button disabled={pending || !email} onClick={() => start(async () => {
              const r = await inviteMemberAction({ email, role });
              if (r.ok) { setLink(r.data.link); setEmail(""); }
              done(r);
            })}><UserPlus />{tm.invite}</Button>
            {link && (
              <div className="space-y-1.5 rounded-md border bg-muted/50 p-3">
                <p className="text-xs font-medium">{tm.link}</p>
                <div className="flex gap-2"><Input readOnly value={link} className="text-xs" /><Button size="icon" variant="outline" onClick={() => { void navigator.clipboard.writeText(link); toast.success(tm.copied); }} aria-label={t.common.copy}><Copy /></Button></div>
              </div>
            )}
            {invitations.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">{tm.pending}</p>
                {invitations.map((i) => (
                  <div key={i.id} className="flex items-center justify-between text-sm">
                    <span>{i.email} · {roles[i.role]}</span>
                    <Button variant="ghost" size="sm" onClick={() => start(async () => done(await revokeInvitationAction(i.id)))}><Trash2 /></Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type Permission = { id: string; email: string; basis: string; recipient_category: string; purpose: string; source: string; obtained_at: string; expires_at: string | null; revoked_at: string | null; evidence_file_path: string | null };
type Suppression = { id: string; email: string | null; domain: string | null; reason: string; source: string; created_at: string };
type Request = { id: string; email: string; type: string; status: string; received_at: string; due_at: string };

export function CompliancePanel(props: {
  rules: { accepted_bases: string[]; require_verified_email: boolean };
  notices: { language: "nl" | "en"; email_footer: string; url: string | null }[];
  permissions: Permission[]; suppression: Suppression[]; requests: Request[]; role: string;
}) {
  const t = useT();
  const c = t.settings.compliance;
  const done = useDone();
  const [pending, start] = useTransition();
  const isAdmin = RANK[props.role] >= RANK.admin;
  const isManager = RANK[props.role] >= RANK.manager;
  const [rules, setRules] = useState(props.rules);
  const lang = t.meta.locale as "nl" | "en";
  const notice = props.notices.find((n) => n.language === lang);
  const [footer, setFooter] = useState(notice?.email_footer ?? (lang === "nl" ? "U ontvangt dit bericht omdat wij denken dat het relevant is voor uw bedrijf. Wilt u geen berichten meer ontvangen? Gebruik de afmeldlink hieronder." : "You receive this message because we think it is relevant for your business. Use the link below to unsubscribe."));
  const footerUrl = notice?.url ?? "";
  const [supValue, setSupValue] = useState("");
  const [dsr, setDsr] = useState({ email: "", type: "access" });

  return (
    <div className="space-y-6">
      <Alert variant="info"><ShieldX /><AlertDescription className="text-foreground">{c.disclaimer}</AlertDescription></Alert>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{c.rules}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Label>{c.acceptedBases}</Label>
            {Object.entries(c.bases).map(([k, v]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <Checkbox checked={rules.accepted_bases.includes(k)} disabled={!isAdmin} onCheckedChange={(on) => setRules({ ...rules, accepted_bases: on ? [...rules.accepted_bases, k] : rules.accepted_bases.filter((x) => x !== k) })} />
                {v}
              </label>
            ))}
            <label className="flex items-center justify-between pt-2 text-sm">{c.requireVerified}<Switch checked={rules.require_verified_email} disabled={!isAdmin} onCheckedChange={(v) => setRules({ ...rules, require_verified_email: v })} /></label>
            {isAdmin && <Button size="sm" disabled={pending || rules.accepted_bases.length === 0} onClick={() => start(async () => done(await updateComplianceRulesAction(rules)))}><Save />{t.common.save}</Button>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{c.privacyNotice}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea rows={5} value={footer} onChange={(e) => setFooter(e.target.value)} disabled={!isAdmin} />
            {isAdmin && <Button size="sm" disabled={pending} onClick={() => start(async () => done(await savePrivacyNoticeAction({ language: lang, email_footer: footer, url: footerUrl })))}><Save />{t.common.save}</Button>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{c.permissions}</CardTitle>
          {isManager && <PermissionDialog />}
        </CardHeader>
        <CardContent className="pt-3">
          <Table>
            <TableHeader><TableRow><TableHead>{t.common.email}</TableHead><TableHead>{c.basis}</TableHead><TableHead>{c.purpose}</TableHead><TableHead>{c.obtainedAt}</TableHead><TableHead>{t.common.status}</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {props.permissions.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">{p.email}<div className="text-xs text-muted-foreground">{p.source}</div></TableCell>
                  <TableCell className="text-sm">{(c.bases as Record<string, string>)[p.basis] ?? p.basis}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm">{p.purpose}</TableCell>
                  <TableCell className="text-sm">{formatDate(p.obtained_at, t.meta.dateLocale)}</TableCell>
                  <TableCell>{p.revoked_at ? <Badge variant="outline">{c.revoked}</Badge> : p.expires_at && new Date(p.expires_at) < new Date() ? <Badge variant="warning">{c.expiresAt}</Badge> : <Badge variant="success">OK</Badge>}{p.evidence_file_path && <Badge variant="secondary" className="ml-1">📎</Badge>}</TableCell>
                  <TableCell>{isManager && !p.revoked_at && <Button variant="ghost" size="sm" onClick={() => start(async () => done(await revokePermissionAction(p.id, "")))}>{c.revoke}</Button>}</TableCell>
                </TableRow>
              ))}
              {props.permissions.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">—</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{c.suppression}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder={c.suppressionValue} value={supValue} onChange={(e) => setSupValue(e.target.value)} />
              <Button disabled={pending || !supValue} onClick={() => start(async () => { done(await addSuppressionAction(supValue, "manual")); setSupValue(""); })}><Plus />{c.addSuppression}</Button>
            </div>
            <div className="max-h-80 divide-y overflow-y-auto">
              {props.suppression.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>{s.email ?? `*@${s.domain}`} <Badge variant="outline" className="ml-1">{s.reason}</Badge></span>
                  {isAdmin && <Button variant="ghost" size="sm" onClick={() => start(async () => done(await removeSuppressionAction(s.id)))}>{c.remove}</Button>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{c.requests}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isManager && (
              <div className="flex gap-2">
                <Input placeholder={t.common.email} value={dsr.email} onChange={(e) => setDsr({ ...dsr, email: e.target.value })} />
                <Select value={dsr.type} onValueChange={(v) => setDsr({ ...dsr, type: v })}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(c.types).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
                <Button disabled={pending || !dsr.email} onClick={() => start(async () => { done(await createSubjectRequestAction(dsr)); setDsr({ email: "", type: "access" }); })}><Plus /></Button>
              </div>
            )}
            <div className="divide-y">
              {props.requests.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>{r.email} · {(c.types as Record<string, string>)[r.type]} <span className="text-xs text-muted-foreground">({c.due} {formatDate(r.due_at, t.meta.dateLocale)})</span></span>
                  {r.status === "completed" ? <Badge variant="success">✓</Badge> : isManager && (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
                      const res = await processSubjectRequestAction(r.id);
                      if (res.ok && res.data.export) {
                        const blob = new Blob([res.data.export], { type: "application/json" });
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `inzage-${r.email}.json`;
                        a.click();
                      }
                      done(res, c.processed);
                    })}>{r.type === "access" ? <Download /> : null}{c.process}</Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PermissionDialog() {
  const t = useT();
  const c = t.settings.compliance;
  const done = useDone();
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState("consent");
  const [category, setCategory] = useState("legal_entity_personal");
  const [pending, start] = useTransition();
  const cats = t.meta.locale === "nl"
    ? { natural_person: "Particulier", sole_trader: "Eenmanszaak / zzp", legal_entity_personal: "Medewerker (persoonlijk adres)", legal_entity_generic: "Algemeen bedrijfsadres", unknown: "Onbekend" }
    : { natural_person: "Private individual", sole_trader: "Sole trader", legal_entity_personal: "Employee (personal address)", legal_entity_generic: "Generic company address", unknown: "Unknown" };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus />{c.addPermission}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{c.addPermission}</DialogTitle></DialogHeader>
        <form
          className="grid gap-3"
          action={(fd) => start(async () => {
            fd.set("basis", basis);
            fd.set("recipient_category", category);
            const r = await addPermissionAction(fd);
            done(r);
            if (r.ok) setOpen(false);
          })}
        >
          <div className="space-y-1.5"><Label>{t.common.email}</Label><Input name="email" type="email" required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{c.basis}</Label><Select value={basis} onValueChange={setBasis}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(c.bases).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>{c.category}</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(cats).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1.5"><Label>{c.purpose}</Label><Input name="purpose" required /></div>
          <div className="space-y-1.5"><Label>{c.source}</Label><Input name="source" required /></div>
          <div className="space-y-1.5"><Label>{c.evidence}</Label><Textarea name="evidence" rows={2} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>{c.obtainedAt}</Label><Input name="obtained_at" type="date" required /></div>
            <div className="space-y-1.5"><Label>{c.expiresAt}</Label><Input name="expires_at" type="date" /></div>
          </div>
          <div className="space-y-1.5"><Label>{c.evidenceUrl}</Label><Input name="evidence_url" type="url" /></div>
          <div className="space-y-1.5"><Label>{c.evidenceFile}</Label><Input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.eml" /></div>
          {basis === "other_statutory_exception" && <div className="space-y-1.5"><Label>{c.justification}</Label><Textarea name="justification" rows={3} minLength={20} required /></div>}
          <DialogFooter><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t.common.save}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

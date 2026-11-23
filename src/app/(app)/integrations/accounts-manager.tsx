"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, KeyRound, Loader2, Plug, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { addDemoAccountAction, addSmtpAccountAction, removeAccountAction, testSmtpAction, updateAccountAction, updatePasswordAction } from "./actions";
import { mailErrorCode } from "@/server/sending/mail-errors";

type Account = {
  id: string; provider: string; email_address: string; display_name: string | null; status: string; daily_limit: number;
  hourly_limit: number; min_delay_seconds: number; last_error: string | null; is_mock: boolean; imap_host: string | null;
};

export function AccountsManager(props: { accounts: Account[]; canManage: boolean; gmail: boolean; microsoft: boolean; allowDemo: boolean }) {
  const t = useT();
  const i = t.integrations;
  const router = useRouter();
  const [pending, start] = useTransition();
  const err = (code: string) => toast.error(code.startsWith("mail:") ? (i.mailErrors as Record<string, string>)[code.slice(5)] ?? i.mailErrors.other : (t.common.errors as Record<string, string>)[code] ?? code, { duration: 12_000 });

  return (
    <div className="space-y-4">
      {props.accounts.length === 0 && <p className="text-sm text-muted-foreground">{i.noAccounts}</p>}
      {props.accounts.map((a) => <AccountRow key={a.id} account={a} canManage={props.canManage} />)}
      {props.canManage && (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          <SmtpDialog onDone={() => router.refresh()} onError={err} />
          <Button variant="outline" size="sm" disabled={!props.gmail} title={props.gmail ? undefined : i.oauthNotConfigured} asChild={props.gmail}>
            {props.gmail ? <a href="/api/oauth/google/start"><Plug />{i.connectGmail}</a> : <span><Plug />{i.connectGmail}</span>}
          </Button>
          <Button variant="outline" size="sm" disabled={!props.microsoft} title={props.microsoft ? undefined : i.oauthNotConfigured} asChild={props.microsoft}>
            {props.microsoft ? <a href="/api/oauth/microsoft/start"><Plug />{i.connectMicrosoft}</a> : <span><Plug />{i.connectMicrosoft}</span>}
          </Button>
          {props.allowDemo && (
            <Button variant="ghost" size="sm" disabled={pending} title={i.demoHint} onClick={() => start(async () => {
              const r = await addDemoAccountAction(`demo-${Date.now().toString(36)}@voorbeeld.nl`);
              if (r.ok) router.refresh(); else err(r.error);
            })}><FlaskConical />{i.addDemo}</Button>
          )}
        </div>
      )}
      {!props.gmail && !props.microsoft && props.canManage && <p className="text-xs text-muted-foreground">{i.oauthNotConfigured}</p>}
    </div>
  );
}

function AccountRow({ account: a, canManage }: { account: Account; canManage: boolean }) {
  const t = useT();
  const i = t.integrations;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ daily_limit: a.daily_limit, hourly_limit: a.hourly_limit, min_delay_seconds: a.min_delay_seconds, display_name: a.display_name, status: a.status === "paused" ? "paused" : "active" });
  const dirty = form.daily_limit !== a.daily_limit || form.hourly_limit !== a.hourly_limit || form.min_delay_seconds !== a.min_delay_seconds || form.display_name !== a.display_name || form.status !== (a.status === "paused" ? "paused" : "active");
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{a.email_address}</p>
          <p className="text-xs text-muted-foreground">{a.provider.toUpperCase()}{a.imap_host ? " + IMAP" : ""}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {a.is_mock && <Badge variant="mock">{t.mock.label}</Badge>}
          <Badge variant={a.status === "active" ? "success" : a.status === "error" ? "destructive" : "secondary"}>{(i.status as Record<string, string>)[a.status] ?? a.status}</Badge>
        </div>
      </div>
      {a.last_error && (
        <div className="mt-2 flex flex-wrap items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
          <p className="text-sm text-destructive">{(i.mailErrors as Record<string, string>)[mailErrorCode(a.last_error) ?? "other"] ?? i.mailErrors.other}</p>
          {canManage && a.provider === "smtp" && !a.is_mock && <PasswordDialog accountId={a.id} />}
        </div>
      )}
      {!a.last_error && canManage && a.provider === "smtp" && !a.is_mock && <div className="mt-2"><PasswordDialog accountId={a.id} variant="ghost" /></div>}
      {canManage && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="space-y-1"><Label className="text-xs">{i.dailyLimit}</Label><Input type="number" min={1} max={2000} value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: Number(e.target.value) })} /></div>
          <div className="space-y-1"><Label className="text-xs">{i.hourlyLimit}</Label><Input type="number" min={1} max={500} value={form.hourly_limit} onChange={(e) => setForm({ ...form, hourly_limit: Number(e.target.value) })} /></div>
          <div className="space-y-1"><Label className="text-xs">{i.minDelay}</Label><Input type="number" min={10} max={3600} value={form.min_delay_seconds} onChange={(e) => setForm({ ...form, min_delay_seconds: Number(e.target.value) })} /></div>
          <div className="space-y-1"><Label className="text-xs">{i.displayName}</Label><Input value={form.display_name ?? ""} onChange={(e) => setForm({ ...form, display_name: e.target.value || null })} /></div>
          <div className="col-span-2 flex items-center gap-3 sm:col-span-4">
            <label className="flex items-center gap-2 text-sm"><Switch checked={form.status === "active"} onCheckedChange={(c) => setForm({ ...form, status: c ? "active" : "paused" })} />{i.status.active}</label>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" disabled={!dirty || pending} onClick={() => start(async () => {
                const r = await updateAccountAction(a.id, form);
                if (r.ok) { toast.success(t.common.saved); router.refresh(); } else toast.error(t.common.errors.validation);
              })}><Save />{t.common.save}</Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
                const r = await removeAccountAction(a.id);
                if (r.ok) router.refresh(); else toast.error(r.error === "in_use" ? (t.meta.locale === "nl" ? "Account is in gebruik door een campagne." : "Account is used by a campaign.") : t.common.errors.unexpected);
              })}><Trash2 className="text-destructive" />{i.remove}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SmtpDialog({ onDone, onError }: { onDone: () => void; onError: (code: string) => void }) {
  const t = useT();
  const i = t.integrations;
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ email: "", displayName: "", smtpHost: "", smtpPort: "587", imapHost: "", imapPort: "993", username: "", password: "" });
  const field = (k: keyof typeof f, label: string, type = "text") => (
    <div className="space-y-1.5"><Label htmlFor={`smtp-${k}`}>{label}</Label><Input id={`smtp-${k}`} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} autoComplete="off" /></div>
  );
  const payload = () => ({ ...f, smtpPort: Number(f.smtpPort), imapPort: Number(f.imapPort), username: f.username || f.email });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus />{i.addSmtp}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{i.addSmtp}</DialogTitle><DialogDescription>{i.passwordHint}</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {field("email", i.email, "email")}
          {field("displayName", i.displayName)}
          {field("smtpHost", i.smtpHost)}
          {field("smtpPort", i.smtpPort)}
          {field("imapHost", i.imapHost)}
          {field("imapPort", i.imapPort)}
          {field("username", i.username)}
          {field("password", i.password, "password")}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => start(async () => {
            const r = await testSmtpAction(payload());
            if (r.ok) toast.success(i.testOk); else onError(r.error);
          })}>{pending && <Loader2 className="animate-spin" />}{i.test}</Button>
          <Button disabled={pending || !f.email || !f.smtpHost || !f.password} onClick={() => start(async () => {
            const r = await addSmtpAccountAction(payload());
            if (r.ok) { setOpen(false); onDone(); } else onError(r.error);
          })}>{t.common.add}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ accountId, variant = "default" }: { accountId: string; variant?: "default" | "ghost" }) {
  const t = useT();
  const i = t.integrations;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant={variant}><KeyRound />{i.changePassword}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{i.changePassword}</DialogTitle><DialogDescription>{i.passwordHint}</DialogDescription></DialogHeader>
        <div className="space-y-1.5"><Label htmlFor="new-password">{i.password}</Label><Input id="new-password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        <DialogFooter>
          <Button disabled={pending || !pw} onClick={() => start(async () => {
            const r = await updatePasswordAction(accountId, pw);
            if (r.ok) { toast.success(i.passwordSaved); setOpen(false); setPw(""); router.refresh(); }
            else toast.error(r.error.startsWith("mail:") ? (i.mailErrors as Record<string, string>)[r.error.slice(5)] ?? i.mailErrors.other : t.common.errors.unexpected, { duration: 12_000 });
          })}>{pending && <Loader2 className="animate-spin" />}{t.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

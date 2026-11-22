"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, CheckCheck, Loader2, RotateCcw, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { approveAllEligibleAction, approveEmailsAction, regenerateEmailsAction, rejectEmailsAction } from "./actions";

export type ReviewRow = {
  id: string; business_id: string; subject: string | null; body: string | null; recipient_email: string | null;
  opportunity: { title?: string } | null; personalization_score: number | null;
  personalization_evidence: { supported?: boolean }[] | null;
  fact_check: { passed?: boolean; issues?: { severity: string; message: string }[] } | null;
  generation_status: string; review_status: string; compliance_status: string;
  compliance_reasons: { severity: string; nl: string; en: string }[] | null;
  is_mock: boolean; error: string | null; updated_at: string;
  businesses: { name: string; city: string | null } | null; contacts: { full_name: string | null } | null;
};

const FILTERS = ["all", "pending", "approved", "rejected", "failed", "issues"] as const;

export function ReviewTable({ rows, filter, batchId, canWrite }: { rows: ReviewRow[]; filter: string; batchId: string | null; canWrite: boolean }) {
  const t = useT();
  const e = t.emails;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ids = [...selected];
  const lang = t.meta.locale as "nl" | "en";

  function setFilter(f: string) {
    const next = new URLSearchParams(sp.toString());
    if (f === "all") next.delete("filter");
    else next.set("filter", f);
    router.replace(`${pathname}?${next.toString()}`);
  }

  function done(r: { ok: boolean; error?: string }, msg?: string) {
    if (r.ok) {
      if (msg) toast.success(msg);
      setSelected(new Set());
      router.refresh();
    } else toast.error((t.common.errors as Record<string, string>)[r.error ?? ""] ?? t.common.errors.unexpected);
  }

  const statusBadge = (r: ReviewRow) => {
    if (r.generation_status !== "completed") {
      const v = r.generation_status === "failed" ? "destructive" : "secondary";
      return (
        <Badge variant={v}>
          {["queued", "researching", "generating"].includes(r.generation_status) && <Loader2 className="animate-spin" />}
          {(e.genStatus as Record<string, string>)[r.generation_status]}
        </Badge>
      );
    }
    const v = r.review_status === "approved" ? "success" : r.review_status === "rejected" ? "outline" : "warning";
    return <Badge variant={v}>{(e.reviewStatus as Record<string, string>)[r.review_status]}</Badge>;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f ? "border-primary bg-primary-soft text-primary" : "bg-background text-muted-foreground hover:text-foreground"}`}>
              {(e.filters as Record<string, string>)[f]}
            </button>
          ))}
          {batchId && <Link href="/emails" className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:text-foreground">✕ batch</Link>}
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 ? (
              <>
                <span className="text-sm font-medium">{selected.size} {t.common.selected}</span>
                <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await approveEmailsAction(ids); done(r, r.ok ? fmt(e.approved, { count: r.data.count }) : undefined); })}><Check />{e.approveSelected}</Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejectOpen(true)}><X />{e.reject}</Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await regenerateEmailsAction(ids); done(r, r.ok ? fmt(e.requeued, { count: r.data.queued }) : undefined); })}><RotateCcw />{e.regenerate}</Button>
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await approveAllEligibleAction(batchId); done(r, r.ok ? fmt(e.approved, { count: r.data.count }) : undefined); })}>
                    {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />}{e.approveEligible}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{e.approveEligibleHint}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  checked={rows.length > 0 && rows.every((r) => selected.has(r.id)) ? true : selected.size ? "indeterminate" : false}
                  onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.id)) : new Set())}
                  disabled={!canWrite}
                  aria-label={t.common.selectAll}
                />
              </TableHead>
              <TableHead>{e.columns.company}</TableHead>
              <TableHead>{e.columns.subject}</TableHead>
              <TableHead>{e.columns.opportunity}</TableHead>
              <TableHead className="text-center">{e.columns.quality}</TableHead>
              <TableHead>{e.columns.compliance}</TableHead>
              <TableHead>{e.columns.status}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const issues = r.fact_check?.issues ?? [];
              const errors = issues.filter((i) => i.severity === "error");
              const evidence = (r.personalization_evidence ?? []).filter((x) => x.supported).length;
              const blocks = (r.compliance_reasons ?? []).filter((x) => x.severity === "block");
              return (
                <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox checked={selected.has(r.id)} disabled={!canWrite} onCheckedChange={(c) => setSelected((p) => { const n = new Set(p); if (c) n.add(r.id); else n.delete(r.id); return n; })} aria-label={r.businesses?.name ?? r.id} />
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <Link href={`/emails/${r.id}`} className="block truncate font-medium hover:text-primary">{r.businesses?.name ?? "—"}</Link>
                    <span className="block truncate text-xs text-muted-foreground">{r.recipient_email ?? e.noRecipient}{r.contacts?.full_name ? ` · ${r.contacts.full_name}` : ""}</span>
                  </TableCell>
                  <TableCell className="max-w-[340px]">
                    <Link href={`/emails/${r.id}`} className="block">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{r.subject ?? (r.error ? <span className="text-destructive">{r.error}</span> : "—")}</span>
                        {r.is_mock && <Badge variant="mock">{t.mock.label}</Badge>}
                      </span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">{r.body?.replace(/\s+/g, " ").slice(0, 160)}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[200px] text-sm text-muted-foreground"><span className="line-clamp-2">{r.opportunity?.title ?? "—"}</span></TableCell>
                  <TableCell className="text-center">
                    {r.personalization_score != null ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-sm font-semibold tabular">{r.personalization_score}</span>
                        <span className="text-[11px] text-muted-foreground">{evidence} {e.editor.supported}</span>
                      </div>
                    ) : "—"}
                    {errors.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger className="mt-1"><AlertTriangle className="size-4 text-destructive" /></TooltipTrigger>
                        <TooltipContent>{errors.map((x) => x.message).join(" · ")}</TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.compliance_status === "eligible" ? (
                      <Badge variant="success"><ShieldCheck />{e.compliance.eligible}</Badge>
                    ) : r.compliance_status === "blocked" ? (
                      <Tooltip>
                        <TooltipTrigger asChild><span><Badge variant="destructive"><ShieldAlert />{e.compliance.blocked}</Badge></span></TooltipTrigger>
                        <TooltipContent className="max-w-sm">{blocks.map((x) => x[lang]).join(" ")}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Badge variant="outline">{e.compliance.unchecked}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{statusBadge(r)}</TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">{t.common.noResults}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{e.reject}</DialogTitle></DialogHeader>
          <Input value={reason} onChange={(x) => setReason(x.target.value)} placeholder={e.rejectReason} maxLength={500} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" disabled={pending} onClick={() => start(async () => { const r = await rejectEmailsAction(ids, reason); done(r, r.ok ? fmt(e.rejected, { count: r.data.count }) : undefined); setRejectOpen(false); setReason(""); })}>{e.reject}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

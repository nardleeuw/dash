"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AtSign, ChevronLeft, ChevronRight, Globe, ListPlus, Loader2, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LeadStatusBadge, ScoreBadge } from "@/components/app/badges";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { addToListAction, createListAction, deleteBusinessesAction, removeFromListAction, setLeadStatusAction } from "./actions";
import { LeadBulkExtras } from "./bulk-extras";

export type LeadRow = {
  id: string; name: string; kvk_number: string | null; city: string | null; province: string | null; industry: string | null;
  website_url: string | null; phone: string | null; lead_status: string; lead_score: number | null; is_mock: boolean;
  kvk_non_mailing: boolean; location_count: number | null; legal_form: string | null; created_at: string;
  email?: string | null; email_count?: number;
};

const RANK: Record<string, number> = { owner: 50, admin: 40, manager: 30, sales_rep: 20, viewer: 10 };

export function LeadsTable(props: {
  rows: LeadRow[]; total: number; page: number; pageSize: number; lists: { id: string; name: string }[]; role: string;
  countLabel: string; industryLabels: Record<string, string>; activeListId: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [newListOpen, setNewListOpen] = useState(false);
  const [listName, setListName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canWrite = RANK[props.role] >= RANK.sales_rep;
  const canDelete = RANK[props.role] >= RANK.manager;
  const ids = [...selected];
  const all = props.rows.length > 0 && props.rows.every((r) => selected.has(r.id));
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));

  function result(res: { ok: boolean; error?: string }, success?: string) {
    if (res.ok) {
      toast.success(success ?? t.leads.bulk.done);
      setSelected(new Set());
      router.refresh();
    } else toast.error((t.common.errors as Record<string, string>)[res.error ?? ""] ?? t.common.errors.unexpected);
  }

  function goPage(p: number) {
    const next = new URLSearchParams(sp.toString());
    next.set("page", String(p));
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {selected.size > 0 ? <span className="font-medium text-foreground">{selected.size} {t.common.selected}</span> : props.countLabel}
        </p>
        {selected.size > 0 && canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <LeadBulkExtras ids={ids} onDone={() => setSelected(new Set())} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}><ListPlus />{t.leads.bulk.addToList}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {props.lists.map((l) => (
                  <DropdownMenuItem key={l.id} onSelect={() => start(async () => result(await addToListAction(ids, l.id)))}>{l.name}</DropdownMenuItem>
                ))}
                {props.lists.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => setNewListOpen(true)}>{t.leads.bulk.newList}</DropdownMenuItem>
                {props.activeListId && (
                  <DropdownMenuItem variant="destructive" onSelect={() => start(async () => result(await removeFromListAction(ids, props.activeListId)))}>
                    {t.meta.locale === "nl" ? "Verwijderen uit deze lijst" : "Remove from this list"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}><Tag />{t.leads.bulk.setStatus}</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {Object.entries(t.leadStatus).map(([k, v]) => (
                  <DropdownMenuItem key={k} onSelect={() => start(async () => result(await setLeadStatusAction(ids, k)))}>{v}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {canDelete && (
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)} disabled={pending}>
                <Trash2 className="text-destructive" />{t.leads.bulk.delete}
              </Button>
            )}
            {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
        )}
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  checked={all ? true : selected.size > 0 ? "indeterminate" : false}
                  onCheckedChange={(c) => setSelected(c ? new Set(props.rows.map((r) => r.id)) : new Set())}
                  disabled={!canWrite}
                  aria-label={t.common.selectAll}
                />
              </TableHead>
              <TableHead>{t.discover.columns.business}</TableHead>
              <TableHead>{t.leads.city}</TableHead>
              <TableHead>{t.leads.industry}</TableHead>
              <TableHead>{t.common.email}</TableHead>
              <TableHead>{t.common.website}</TableHead>
              <TableHead>{t.leads.status}</TableHead>
              <TableHead className="text-right">{t.leads.score}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rows.map((r) => (
              <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(r.id)}
                    disabled={!canWrite}
                    onCheckedChange={(c) => setSelected((prev) => { const n = new Set(prev); if (c) n.add(r.id); else n.delete(r.id); return n; })}
                    aria-label={r.name}
                  />
                </TableCell>
                <TableCell className="max-w-[320px]">
                  <div className="flex items-center gap-2">
                    <Link href={`/leads/${r.id}`} className="truncate font-medium hover:text-primary">{r.name}</Link>
                    {r.is_mock && <Badge variant="mock">{t.mock.label}</Badge>}
                    {r.kvk_non_mailing && (
                      <Tooltip>
                        <TooltipTrigger><ShieldAlert className="size-4 text-destructive" /></TooltipTrigger>
                        <TooltipContent>{t.leads.nonMailing}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.kvk_number && <span className="tabular">KVK {r.kvk_number}</span>}
                    {r.legal_form && <span> · {r.legal_form}</span>}
                    {(r.location_count ?? 0) > 1 && <span> · {r.location_count} {t.meta.locale === "nl" ? "vestigingen" : "locations"}</span>}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {r.city ?? "—"}
                  {r.province && <div className="text-xs text-muted-foreground">{r.province}</div>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.industry ? props.industryLabels[r.industry] ?? r.industry : "—"}</TableCell>
                <TableCell className="text-sm">
                  {r.email ? (
                    <span className="flex max-w-[220px] items-center gap-1.5 truncate"><AtSign className="size-3.5 shrink-0 text-muted-foreground" />{r.email}{(r.email_count ?? 0) > 1 && <span className="text-xs text-muted-foreground">+{(r.email_count ?? 1) - 1}</span>}</span>
                  ) : <span className="text-xs text-muted-foreground">{t.leads.noEmailYet}</span>}
                </TableCell>
                <TableCell className="text-sm">
                  {r.website_url ? (
                    <a href={r.website_url} target="_blank" rel="noopener noreferrer nofollow" className="flex max-w-[180px] items-center gap-1.5 truncate text-primary hover:underline">
                      <Globe className="size-3.5 shrink-0" />{r.website_url.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell><LeadStatusBadge status={r.lead_status} /></TableCell>
                <TableCell className="text-right"><ScoreBadge score={r.lead_score} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">{t.common.page} {props.page} {t.common.of} {pages}</span>
          <Button variant="outline" size="icon-sm" disabled={props.page <= 1} onClick={() => goPage(props.page - 1)} aria-label={t.common.previous}><ChevronLeft /></Button>
          <Button variant="outline" size="icon-sm" disabled={props.page >= pages} onClick={() => goPage(props.page + 1)} aria-label={t.common.next}><ChevronRight /></Button>
        </div>
      )}

      <Dialog open={newListOpen} onOpenChange={setNewListOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.leads.newList}</DialogTitle></DialogHeader>
          <Input value={listName} onChange={(e) => setListName(e.target.value)} placeholder={t.leads.listName} maxLength={120} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewListOpen(false)}>{t.common.cancel}</Button>
            <Button
              disabled={!listName.trim() || pending}
              onClick={() => start(async () => {
                const created = await createListAction(listName);
                if (!created.ok) return result(created);
                result(await addToListAction(ids, created.data.id));
                setNewListOpen(false);
                setListName("");
              })}
            >
              {t.common.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.leads.bulk.delete}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{fmt(t.leads.bulk.confirmDelete, { count: ids.length })}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>{t.common.cancel}</Button>
            <Button variant="destructive" disabled={pending} onClick={() => start(async () => { result(await deleteBusinessesAction(ids)); setConfirmDelete(false); })}>
              {t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

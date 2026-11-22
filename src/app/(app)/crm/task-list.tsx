"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/i18n/client";
import { formatDate } from "@/i18n/format";
import { createTaskAction, deleteTaskAction, setTaskStatusAction } from "./actions";

type Task = { id: string; title: string; description: string | null; due_at: string | null; assignee_id: string | null; business_id: string | null; business: string | null };

export function TaskList({ tasks, members, currentUserId, canWrite, businessId }: { tasks: Task[]; members: { id: string; name: string }[]; currentUserId: string; canWrite: boolean; businessId?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scope, setScope] = useState<"mine" | "all">(businessId ? "all" : "mine");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState(currentUserId);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const visible = tasks.filter((x) => scope === "all" || x.assignee_id === currentUserId);
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? "—";
  const done = (r: { ok: boolean }) => {
    if (r.ok) router.refresh();
    else toast.error(t.common.errors.unexpected);
  };

  return (
    <section>
      {!businessId && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t.crm.tasks}</h2>
          <div className="flex gap-1.5">
            {(["mine", "all"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={`rounded-full border px-3 py-1 text-xs font-medium ${scope === s ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground"}`}>{s === "mine" ? t.crm.myTasks : t.crm.allTasks}</button>
            ))}
          </div>
        </div>
      )}
      <Card>
        <CardContent className="space-y-3">
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <Input className="min-w-56 flex-1" placeholder={t.crm.taskTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
              <Input type="date" className="w-40" value={due} onChange={(e) => setDue(e.target.value)} aria-label={t.crm.due} />
              <Select value={assignee} onValueChange={setAssignee}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>{members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select>
              <Button disabled={pending || !title.trim()} onClick={() => start(async () => {
                done(await createTaskAction({ title, businessId: businessId ?? null, dueAt: due ? new Date(`${due}T09:00:00`).toISOString() : null, assigneeId: assignee }));
                setTitle(""); setDue("");
              })}><Plus />{t.crm.newTask}</Button>
            </div>
          )}
          <div className="divide-y">
            {visible.length === 0 && <p className="py-4 text-sm text-muted-foreground">{t.crm.noTasks}</p>}
            {visible.map((x) => {
              const overdue = x.due_at && new Date(x.due_at) < now && x.due_at.slice(0, 10) !== today;
              return (
                <div key={x.id} className="flex items-center gap-3 py-2.5">
                  <Checkbox disabled={!canWrite} onCheckedChange={() => start(async () => done(await setTaskStatusAction(x.id, true)))} aria-label={t.crm.complete} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{x.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {x.business && x.business_id && !businessId && <Link href={`/leads/${x.business_id}`} className="hover:text-foreground">{x.business} · </Link>}
                      {name(x.assignee_id)}{x.description ? ` · ${x.description}` : ""}
                    </p>
                  </div>
                  {x.due_at && <Badge variant={overdue ? "destructive" : x.due_at.slice(0, 10) === today ? "warning" : "outline"}>{overdue ? t.crm.overdue : x.due_at.slice(0, 10) === today ? t.crm.dueToday : formatDate(x.due_at, t.meta.dateLocale)}</Badge>}
                  {canWrite && <Button variant="ghost" size="icon-sm" onClick={() => start(async () => done(await deleteTaskAction(x.id)))} aria-label={t.common.delete}><Trash2 /></Button>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

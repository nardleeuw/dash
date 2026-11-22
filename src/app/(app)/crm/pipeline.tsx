"use client";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { ScoreBadge } from "@/components/app/badges";
import { useT } from "@/i18n/client";
import { setLeadStatusAction } from "@/app/(app)/leads/actions";
import { cn } from "@/lib/utils";

type Lead = { id: string; name: string; city: string | null; lead_status: string; lead_score: number | null; recommended_service: string | null };

export function Pipeline({ columns, leads, canWrite, mine }: { columns: string[]; leads: Lead[]; canWrite: boolean; mine: boolean }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [, start] = useTransition();
  const [optimistic, move] = useOptimistic(leads, (state, { id, status }: { id: string; status: string }) => state.map((l) => (l.id === id ? { ...l, lead_status: status } : l)));

  function drop(status: string, id: string) {
    start(async () => {
      move({ id, status });
      const r = await setLeadStatusAction([id], status);
      if (!r.ok) toast.error(t.common.errors.unexpected);
      router.refresh();
    });
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{t.crm.pipeline}</h2>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t.crm.onlyMine}
          <Switch checked={mine} onCheckedChange={(c) => router.replace(c ? `${pathname}?mine=1` : pathname)} />
        </label>
      </div>
      {canWrite && <p className="mb-3 text-xs text-muted-foreground">{t.crm.dragHint}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const items = optimistic.filter((l) => l.lead_status === col);
          return (
            <div
              key={col}
              className="flex w-64 shrink-0 flex-col rounded-xl border bg-muted/40"
              onDragOver={(e) => canWrite && e.preventDefault()}
              onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); if (id) drop(col, id); }}
            >
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm font-medium">{(t.leadStatus as Record<string, string>)[col]}</span>
                <span className="rounded-full bg-background px-2 text-xs text-muted-foreground tabular">{items.length}</span>
              </div>
              <div className="flex max-h-[520px] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {items.map((l) => (
                  <div
                    key={l.id}
                    draggable={canWrite}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
                    className={cn("rounded-lg border bg-background p-2.5 shadow-xs", canWrite && "cursor-grab active:cursor-grabbing")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/leads/${l.id}`} className="text-sm font-medium leading-snug hover:text-primary">{l.name}</Link>
                      <ScoreBadge score={l.lead_score} />
                    </div>
                    {l.city && <p className="mt-0.5 text-xs text-muted-foreground">{l.city}</p>}
                    {l.recommended_service && <p className="mt-1 line-clamp-1 text-xs text-primary">{l.recommended_service}</p>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

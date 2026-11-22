"use client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  new: "secondary", enriched: "secondary", qualified: "default", approved: "default", contacted: "outline",
  replied: "warning", interested: "success", meeting_booked: "success", customer: "success", not_interested: "outline", suppressed: "destructive",
};

export function LeadStatusBadge({ status }: { status: string }) {
  const t = useT();
  return <Badge variant={STATUS_VARIANT[status] ?? "secondary"}>{(t.leadStatus as Record<string, string>)[status] ?? status}</Badge>;
}

export function ScoreBadge({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score == null) return <span className={cn("text-sm text-muted-foreground", className)}>—</span>;
  const tone = score >= 70 ? "bg-success-soft text-success" : score >= 45 ? "bg-primary-soft text-primary" : "bg-secondary text-muted-foreground";
  return <span className={cn("inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular", tone, className)}>{score}</span>;
}

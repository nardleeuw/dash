"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { approveAllEligibleAction, regenerateFailedAction } from "./actions";

export function BatchActions({ batchId, failed, canWrite }: { batchId: string; failed: number; canWrite: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canWrite) return null;
  return (
    <>
      {failed > 0 && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
          const r = await regenerateFailedAction(batchId);
          if (r.ok) { toast.success(fmt(t.emails.requeued, { count: r.data.queued })); router.refresh(); }
        })}>{pending ? <Loader2 className="animate-spin" /> : <RotateCcw />}{t.emails.regenerateFailed}</Button>
      )}
      <Button size="sm" variant="outline" disabled={pending} title={t.emails.approveEligibleHint} onClick={() => start(async () => {
        const r = await approveAllEligibleAction(batchId);
        if (r.ok) { toast.success(fmt(t.emails.approved, { count: r.data.count })); router.refresh(); }
      })}><CheckCheck />{t.emails.approveEligible}</Button>
    </>
  );
}

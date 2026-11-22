"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { startResearchAction } from "@/app/(app)/research/actions";
import { GenerateEmailsButton } from "./generate-button";

/** Bulk actions contributed by the intelligence and email phases. */
export function LeadBulkExtras({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
        const r = await startResearchAction(ids);
        if (r.ok) {
          toast.success(fmt(t.research.queued, { count: r.data.queued }) + (r.data.skipped ? " " + fmt(t.research.skipped, { count: r.data.skipped }) : ""));
          onDone();
          router.refresh();
        } else toast.error(t.common.errors.unexpected);
      })}>
        {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}{t.research.start}
      </Button>
      <GenerateEmailsButton ids={ids} onDone={onDone} />
    </>
  );
}

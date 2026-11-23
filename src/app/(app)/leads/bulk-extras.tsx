"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AtSign, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { findContactsBulkAction } from "@/app/(app)/research/actions";
import { GenerateEmailsButton } from "./generate-button";

/** Bulk actions contributed by the intelligence and email phases. */
export function LeadBulkExtras({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
        const r = await findContactsBulkAction(ids);
        if (r.ok) {
          toast.success(fmt(t.research.bulkContactsQueued, { count: r.data.queued }), { description: r.data.capped ? t.research.bulkContactsCapped : undefined });
          onDone();
          setTimeout(() => router.refresh(), 20_000);
        } else toast.error((t.common.errors as Record<string, string>)[r.error] ?? t.common.errors.unexpected);
      })}>
        {pending ? <Loader2 className="animate-spin" /> : <AtSign />}{t.research.bulkContacts}
      </Button>
      <GenerateEmailsButton ids={ids} onDone={onDone} />
    </>
  );
}

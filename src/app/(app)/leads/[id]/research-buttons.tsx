"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { findContactsAction, startResearchAction, verifyEmailAction } from "@/app/(app)/research/actions";

function useErr() {
  const t = useT();
  return (code: string) => {
    const map: Record<string, string> = { ...(t.common.errors as Record<string, string>), no_domain: t.research.noDomain, not_configured: t.research.notConfigured };
    toast.error(map[code] ?? t.common.errors.unexpected);
  };
}

export function ResearchButton({ businessId, label, disabled }: { businessId: string; label: string; disabled?: boolean }) {
  const t = useT();
  const router = useRouter();
  const err = useErr();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" disabled={pending || disabled} onClick={() => start(async () => {
      const r = await startResearchAction([businessId]);
      if (r.ok) { toast.success(fmt(t.research.queued, { count: r.data.queued })); router.refresh(); } else err(r.error);
    })}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}{label}
    </Button>
  );
}

export function FindContactsButton({ businessId }: { businessId: string }) {
  const t = useT();
  const router = useRouter();
  const err = useErr();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => {
      const r = await findContactsAction(businessId);
      if (r.ok) { toast.success(fmt(t.research.contactsFound, r.data)); router.refresh(); } else err(r.error);
    })}>
      {pending ? <Loader2 className="animate-spin" /> : <Search />}{t.research.findContacts}
    </Button>
  );
}

export function VerifyEmailButton({ contactId, businessId }: { contactId: string; businessId: string }) {
  const t = useT();
  const router = useRouter();
  const err = useErr();
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={() => start(async () => {
      const r = await verifyEmailAction(contactId, businessId);
      if (r.ok) { toast.success(r.data.status); router.refresh(); } else err(r.error);
    })}>
      {pending ? <Loader2 className="animate-spin" /> : <BadgeCheck />}{t.research.verifyEmail}
    </Button>
  );
}

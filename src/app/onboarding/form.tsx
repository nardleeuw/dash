"use client";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/client";
import { createWorkspaceAction } from "@/server/workspace/actions";

export function OnboardingForm({ plan }: { plan?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(createWorkspaceAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {plan && <input type="hidden" name="plan" value={plan} />}
      <div className="space-y-1.5">
        <Label htmlFor="name">{t.onboarding.orgName}</Label>
        <Input id="name" name="name" placeholder={t.onboarding.orgNamePlaceholder} required maxLength={120} autoFocus />
      </div>
      {state?.error && <p className="text-sm text-destructive">{(t.common.errors as Record<string, string>)[state.error] ?? t.common.errors.unexpected}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {t.onboarding.submit}
      </Button>
    </form>
  );
}

"use client";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useT } from "@/i18n/client";
import type { AuthState } from "./actions";

type Field = { name: string; type: string; label: string; autoComplete?: string; hint?: string; placeholder?: string };

export function AuthForm({
  action,
  fields,
  submitLabel,
  hidden,
  footer,
}: {
  action: (prev: AuthState, fd: FormData) => Promise<AuthState>;
  fields: Field[];
  submitLabel: string;
  hidden?: Record<string, string>;
  footer?: React.ReactNode;
}) {
  const t = useT();
  const [state, formAction, pending] = useActionState(action, undefined);
  const messages = { ...t.auth, ...t.common.errors } as Record<string, string>;
  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <div key={f.name} className="space-y-1.5">
          <Label htmlFor={f.name}>{f.label}</Label>
          <Input id={f.name} name={f.name} type={f.type} autoComplete={f.autoComplete} placeholder={f.placeholder} required />
          {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
        </div>
      ))}
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription className="col-start-1 text-foreground">{messages[state.error] ?? t.common.errors.unexpected}</AlertDescription>
        </Alert>
      )}
      {state?.message && (
        <Alert variant="success">
          <AlertDescription className="col-start-1 text-foreground">{messages[state.message] ?? state.message}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {submitLabel}
      </Button>
      {footer}
    </form>
  );
}

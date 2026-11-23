"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Activity, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/client";
import { checkProvidersAction } from "./actions";
import type { HealthResult } from "@/server/providers/health";

const NAMES: Record<string, string> = { openai: "OpenAI", google_places: "Google Places", hunter: "Hunter.io" };

/** Platform-admin tool: verifies the platform API keys with a free or minimal call. */
export function ProviderCheck() {
  const t = useT();
  const c = t.integrations.check;
  const [pending, start] = useTransition();
  const [results, setResults] = useState<HealthResult[] | null>(null);

  return (
    <div className="space-y-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-sm text-xs text-muted-foreground">{c.hint}</p>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => start(async () => {
            const r = await checkProvidersAction();
            if (r.ok) setResults(r.data);
            else toast.error((t.common.errors as Record<string, string>)[r.error] ?? t.common.errors.unexpected);
          })}
        >
          {pending ? <Loader2 className="animate-spin" /> : <Activity />}{c.button}
        </Button>
      </div>
      {results && (
        <ul className="space-y-2" aria-live="polite">
          {results.map((r) => (
            <li key={r.provider} className="flex items-center justify-between gap-3 text-sm">
              <span>{NAMES[r.provider] ?? r.provider}</span>
              <Badge variant={r.status === "ok" ? "success" : r.status === "mock" ? "mock" : r.status === "not_configured" ? "outline" : "destructive"}>
                {c.status[r.status]}{r.detail ? ` · ${r.detail}` : ""}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

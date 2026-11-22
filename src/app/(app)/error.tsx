"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border bg-destructive-soft"><AlertTriangle className="size-5 text-destructive" /></div>
      <p className="text-sm text-muted-foreground">{t.common.errors.unexpected}</p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">ref: {error.digest}</p>}
      <Button variant="outline" onClick={reset}>{t.common.retry}</Button>
    </div>
  );
}

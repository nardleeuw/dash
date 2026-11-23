"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { sendRunControlAction } from "./actions";

export function SendRunControls({ id, status }: { id: string; status: string }) {
  const t = useT();
  const s = t.emails.send;
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (a: "pause" | "resume" | "cancel") => start(async () => {
    const r = await sendRunControlAction(id, a);
    if (!r.ok) toast.error((t.common.errors as Record<string, string>)[r.error] ?? t.common.errors.unexpected);
    router.refresh();
  });
  if (!["running", "paused", "scheduled"].includes(status)) return null;
  return (
    <div className="flex justify-end gap-1.5">
      {status === "running" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act("pause")}><Pause />{s.pause}</Button>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => act("resume")}><Play />{s.resume}</Button>
      )}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => act("cancel")}><Square />{s.cancel}</Button>
    </div>
  );
}

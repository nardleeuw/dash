"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquareReply } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n/client";
import { simulateReplyAction } from "@/app/(app)/inbox/actions";

/** Demo-only: simulate a prospect's reply on a mock sending account. */
export function SimulateReply({ recipientId }: { recipientId: string }) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  return (
    <Popover>
      <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" title={t.inbox.simulate} aria-label={t.inbox.simulate}><MessageSquareReply /></Button></PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2">
        <p className="text-xs font-medium">{t.inbox.simulate}</p>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t.inbox.simulatePlaceholder} />
        <Button size="sm" disabled={pending || text.length < 2} onClick={() => start(async () => {
          const r = await simulateReplyAction(recipientId, text);
          if (r.ok) { toast.success((t.inbox.categories as Record<string, string>)[r.data.category] ?? r.data.category); setText(""); router.refresh(); }
          else toast.error(t.common.errors.forbidden);
        })}>{t.inbox.send}</Button>
      </PopoverContent>
    </Popover>
  );
}

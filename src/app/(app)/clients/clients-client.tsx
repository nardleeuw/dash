"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { archiveClientAction, createClientAction } from "./actions";

export function NewClientButton() {
  const t = useT();
  const c = t.clients;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", website: "", description: "", contact_email: "" });
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus />{c.new}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{c.new}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>{c.name}</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{c.website}</Label><Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{c.contactEmail}</Label><Input type="email" value={f.contact_email} onChange={(e) => setF({ ...f, contact_email: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{c.description}</Label><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button disabled={pending || !f.name.trim()} onClick={() => start(async () => {
            const r = await createClientAction(f);
            if (r.ok) { setOpen(false); setF({ name: "", website: "", description: "", contact_email: "" }); router.refresh(); } else toast.error(t.common.errors.validation);
          })}>{pending && <Loader2 className="animate-spin" />}{t.common.create}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveClientButton({ id, archived }: { id: string; archived: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" size="sm" className="ml-auto h-7" disabled={pending} onClick={() => start(async () => { await archiveClientAction(id, !archived); router.refresh(); })}>
      <Archive />{archived ? t.common.open : t.clients.archive}
    </Button>
  );
}

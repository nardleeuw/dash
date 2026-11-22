"use client";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { createCampaignAction } from "./actions";

export function NewCampaignButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus />{t.campaigns.new}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.campaigns.new}</DialogTitle></DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.campaigns.name} maxLength={160} autoFocus />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button disabled={!name.trim() || pending} onClick={() => start(() => createCampaignAction(name))}>{pending && <Loader2 className="animate-spin" />}{t.common.create}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

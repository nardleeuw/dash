"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { addContactAction } from "../actions";

export function AddContactButton({ businessId }: { businessId: string }) {
  const t = useT();
  const nl = t.meta.locale === "nl";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ fullName: "", jobTitle: "", email: "", phone: "", recipientCategory: "unknown" });
  const categories = nl
    ? { natural_person: "Particulier", sole_trader: "Eenmanszaak / zzp", legal_entity_personal: "Medewerker (persoonlijk adres)", legal_entity_generic: "Algemeen bedrijfsadres", unknown: "Onbekend" }
    : { natural_person: "Private individual", sole_trader: "Sole trader", legal_entity_personal: "Employee (personal address)", legal_entity_generic: "Generic company address", unknown: "Unknown" };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Plus />{t.leads.profile.addContact}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.leads.profile.addContact}</DialogTitle>
          <DialogDescription>{nl ? "De ontvangercategorie bepaalt welke compliance-regels gelden." : "The recipient category determines which compliance rules apply."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {(["fullName", "jobTitle", "email", "phone"] as const).map((k) => (
            <div key={k} className="space-y-1.5">
              <Label htmlFor={k}>{{ fullName: nl ? "Naam" : "Name", jobTitle: nl ? "Functie" : "Job title", email: t.common.email, phone: t.common.phone }[k]}</Label>
              <Input id={k} value={form[k]} type={k === "email" ? "email" : "text"} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label>{nl ? "Ontvangercategorie" : "Recipient category"}</Label>
            <Select value={form.recipientCategory} onValueChange={(v) => setForm({ ...form, recipientCategory: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(categories).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button
            disabled={pending || (!form.fullName && !form.email)}
            onClick={() => start(async () => {
              const r = await addContactAction(businessId, form);
              if (r.ok) { setOpen(false); router.refresh(); }
              else toast.error(r.error === "duplicate" ? (nl ? "Dit e-mailadres bestaat al." : "This email already exists.") : t.common.errors.validation);
            })}
          >
            {t.common.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

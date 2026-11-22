"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { saveScoringAction } from "./actions";

export function ScoringDialog(props: { weights: Record<string, number>; targetProvinces: string[]; provinces: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [weights, setWeights] = useState(props.weights);
  const [provinces, setProvinces] = useState<string[]>(props.targetProvinces);
  const [pending, start] = useTransition();
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><SlidersHorizontal />{t.research.scoring}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.research.scoring}</DialogTitle>
          <DialogDescription>{t.research.scoringHint}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {Object.entries(weights).map(([k, v]) => (
            <div key={k} className="space-y-2">
              <div className="flex justify-between text-sm">
                <Label>{(t.research.factors as Record<string, string>)[k] ?? k}</Label>
                <span className="tabular text-muted-foreground">{v} · {Math.round((v / total) * 100)}%</span>
              </div>
              <Slider min={0} max={100} step={5} value={[v]} onValueChange={(x) => setWeights({ ...weights, [k]: x[0] })} />
            </div>
          ))}
          <div className="space-y-2 pt-2">
            <Label>{t.research.targetProvinces}</Label>
            <div className="grid grid-cols-3 gap-2">
              {props.provinces.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={provinces.includes(p)} onCheckedChange={(c) => setProvinces(c ? [...provinces, p] : provinces.filter((x) => x !== p))} />
                  {p}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await saveScoringAction({ weights, targetProvinces: provinces });
            if (r.ok) { toast.success(t.common.saved); setOpen(false); } else toast.error(t.common.errors.unexpected);
          })}>{t.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

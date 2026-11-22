"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/i18n/client";

export function LeadsFilters(props: { industries: { key: string; label: string }[]; provinces: string[]; lists: { id: string; name: string }[] }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(sp.toString());
    if (value === null || value === "" || value === "all") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  }

  useEffect(() => {
    const h = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) set("q", q);
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const statusEntries = Object.entries(t.leadStatus);
  const advancedCount = ["website", "email", "phone", "multi", "nonmailing", "minScore", "researched", "nobooking", "notmobile", "nohttps", "noform", "outdated"].filter((k) => sp.get(k)).length;
  const anyFilter = [...sp.keys()].some((k) => k !== "page" && k !== "sort");

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-72">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.leads.searchPlaceholder} className="pl-8" />
      </div>
      <FilterSelect value={sp.get("status")} placeholder={t.leads.allStatuses} onChange={(v) => set("status", v)} options={statusEntries.map(([k, v]) => ({ value: k, label: v }))} />
      <FilterSelect value={sp.get("industry")} placeholder={t.leads.allIndustries} onChange={(v) => set("industry", v)} options={props.industries.map((i) => ({ value: i.key, label: i.label }))} />
      <FilterSelect value={sp.get("province")} placeholder={t.leads.allProvinces} onChange={(v) => set("province", v)} options={props.provinces.map((p) => ({ value: p, label: p }))} />
      {props.lists.length > 0 && <FilterSelect value={sp.get("list")} placeholder={t.leads.allLists} onChange={(v) => set("list", v)} options={props.lists.map((l) => ({ value: l.id, label: l.name }))} />}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9">
            <SlidersHorizontal />
            {t.common.filters}
            {advancedCount > 0 && <span className="rounded bg-primary px-1.5 text-[11px] text-primary-foreground">{advancedCount}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-3" align="end">
          {[
            ["website", t.leads.hasWebsite],
            ["email", t.leads.hasEmail],
            ["phone", t.leads.hasPhone],
            ["multi", t.leads.multiLocation],
          ].map(([k, label]) => (
            <label key={k} className="flex items-center justify-between text-sm">
              {label}
              <Switch checked={sp.get(k) === "1"} onCheckedChange={(c) => set(k, c ? "1" : null)} />
            </label>
          ))}
          <label className="flex items-center justify-between text-sm">
            {t.meta.locale === "nl" ? "Verberg KVK non-mailing" : "Hide KVK non-mailing"}
            <Switch checked={sp.get("nonmailing") === "0"} onCheckedChange={(c) => set("nonmailing", c ? "0" : null)} />
          </label>
          <div className="space-y-3 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">{t.research.signals}</p>
            {[
              ["researched", t.research.filters.researched],
              ["nobooking", t.research.filters.noBooking],
              ["notmobile", t.research.filters.notMobile],
              ["nohttps", t.research.filters.noHttps],
              ["noform", t.research.filters.noContactForm],
              ["outdated", t.research.filters.outdated],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center justify-between text-sm">
                {label}
                <Switch checked={sp.get(k) === "1"} onCheckedChange={(c) => set(k, c ? "1" : null)} />
              </label>
            ))}
          </div>
          <div className="space-y-2 border-t pt-3">
            <div className="flex justify-between text-sm"><span>{t.leads.minScore}</span><span className="tabular text-muted-foreground">{sp.get("minScore") ?? 0}</span></div>
            <Slider min={0} max={100} step={5} defaultValue={[Number(sp.get("minScore") ?? 0)]} onValueCommit={(v) => set("minScore", v[0] > 0 ? String(v[0]) : null)} />
          </div>
        </PopoverContent>
      </Popover>
      <Select value={sp.get("sort") ?? "created"} onValueChange={(v) => set("sort", v === "created" ? null : v)}>
        <SelectTrigger size="sm" className="h-9 w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="created">{t.meta.locale === "nl" ? "Nieuwste eerst" : "Newest first"}</SelectItem>
          <SelectItem value="score">{t.meta.locale === "nl" ? "Hoogste score" : "Highest score"}</SelectItem>
          <SelectItem value="name">{t.common.name}</SelectItem>
        </SelectContent>
      </Select>
      {anyFilter && (
        <Button variant="ghost" size="sm" onClick={() => { setQ(""); start(() => router.replace(pathname)); }}>
          <X />{t.common.reset}
        </Button>
      )}
    </div>
  );
}

function FilterSelect({ value, placeholder, options, onChange }: { value: string | null; placeholder: string; options: { value: string; label: string }[]; onChange: (v: string | null) => void }) {
  return (
    <Select value={value ?? "all"} onValueChange={(v) => onChange(v === "all" ? null : v)}>
      <SelectTrigger size="sm" className="h-9 w-auto min-w-36"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

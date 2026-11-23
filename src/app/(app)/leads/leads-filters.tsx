"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

  const anyFilter = [...sp.keys()].some((k) => k !== "page" && k !== "sort");

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-72">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.leads.searchPlaceholder} className="pl-8" />
      </div>
      <FilterSelect value={sp.get("industry")} placeholder={t.leads.allIndustries} onChange={(v) => set("industry", v)} options={props.industries.map((i) => ({ value: i.key, label: i.label }))} />
      <FilterSelect value={sp.get("province")} placeholder={t.leads.allProvinces} onChange={(v) => set("province", v)} options={props.provinces.map((p) => ({ value: p, label: p }))} />
      <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
        <Switch checked={sp.get("email") === "1"} onCheckedChange={(c) => set("email", c ? "1" : null)} />
        {t.leads.hasEmail}
      </label>
      <Select value={sp.get("sort") ?? "created"} onValueChange={(v) => set("sort", v === "created" ? null : v)}>
        <SelectTrigger size="sm" className="h-9 w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="created">{t.meta.locale === "nl" ? "Nieuwste eerst" : "Newest first"}</SelectItem>
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

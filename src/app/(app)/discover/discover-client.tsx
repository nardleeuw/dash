"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AtSign, Bookmark, Building2, Check, ChevronDown, Globe, Loader2, MapPin, Phone, Search, Star, Trash2, X, Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/app/page-header";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { fmt } from "@/i18n/format";
import { mergeSearchResults, type MergedResult } from "@/server/discovery/dedupe";
import { formatPostalCode } from "@/server/discovery/normalize";
import type { DiscoveredBusiness, DiscoveryProvider, LocationFilter } from "@/server/providers/types";
import type { SearchFilters } from "@/lib/discovery-schema";
import { deleteSavedSearchAction, importAction, peekEmailsAction, saveSearchAction, searchAction, touchSavedSearchAction } from "./actions";

/** Keep loading pages automatically until this many results (user can stop or load more). */
const AUTO_LOAD_TARGET = 400;

type ProviderStatus = "live" | "mock" | "disabled" | "test";
type Saved = { id: string; name: string; filters: SearchFilters; last_run_at: string | null; last_result_count: number | null };
type Suggestion = { id: string; type: "provincie" | "gemeente" | "woonplaats" | "postcode"; label: string; name: string; lat: number; lng: number };

const PROVIDERS: DiscoveryProvider[] = ["google_places", "osm"];
const PROVIDER_LABEL: Record<DiscoveryProvider, string> = { kvk: "KVK", google_places: "Google Places", osm: "OpenStreetMap" };
const TYPE_MAP: Record<Suggestion["type"], LocationFilter["type"]> = { provincie: "province", gemeente: "municipality", woonplaats: "city", postcode: "postcode" };

export function DiscoverClient(props: {
  providers: Record<DiscoveryProvider, ProviderStatus>;
  industries: IndustryOption[];
  savedSearches: Saved[];
  lists: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const t = useT();
  const d = t.discover;
  const [text, setText] = useState("");
  const [industries, setIndustries] = useState<string[]>([]);
  const [locations, setLocations] = useState<LocationFilter[]>([]);
  const [radiusKm, setRadiusKm] = useState(8);
  const [providers, setProviders] = useState<DiscoveryProvider[]>(PROVIDERS.filter((p) => props.providers[p] !== "disabled"));
  const [requireWebsite, setRequireWebsite] = useState(false);
  const [requirePhone, setRequirePhone] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [kvkType, setKvkType] = useState<string>("any");

  const [raw, setRaw] = useState<DiscoveredBusiness[]>([]);
  const [cursors, setCursors] = useState<Partial<Record<DiscoveryProvider, string | null>>>({});
  const [notices, setNotices] = useState<Partial<Record<DiscoveryProvider, string>>>({});
  const [errors, setErrors] = useState<{ provider: DiscoveryProvider; message: string }[]>([]);
  const [existing, setExisting] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searched, setSearched] = useState(false);
  const [activeSaved, setActiveSaved] = useState<string | null>(null);
  const [listId, setListId] = useState<string>("none");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [pending, startTransition] = useTransition();
  const [importing, startImport] = useTransition();

  const filters = (): SearchFilters => ({
    text: text.trim() || undefined,
    industries,
    locations,
    radiusKm,
    providers,
    requireWebsite,
    requirePhone,
    activeOnly,
    kvkType: kvkType === "any" ? undefined : (kvkType as SearchFilters["kvkType"]),
  });

  const merged: MergedResult[] = useMemo(() => {
    const filtered = raw.filter((r) => {
      if (activeOnly && r.businessStatus === "inactive") return false;
      if (requireWebsite && !r.website) return false;
      if (requirePhone && !r.phone) return false;
      return true;
    });
    return mergeSearchResults(filtered);
  }, [raw, activeOnly, requireWebsite, requirePhone]);

  const hasMore = providers.some((p) => cursors[p] !== null && cursors[p] !== undefined);
  const [autoLoad, setAutoLoad] = useState(false);
  // Emails read from each result's website (free, in the background, 20 at a time).
  const [peeked, setPeeked] = useState<Record<string, string[] | "pending">>({});
  const peeking = useRef(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const autoLoading = autoLoad && hasMore && raw.length < AUTO_LOAD_TARGET;
  // Keep fetching the next batch (tiles × queries) until enough results or nothing left.
  useEffect(() => {
    if (autoLoading && !pending && searched) run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoading, pending, searched, cursors]);

  function run(reset: boolean, f = filters()) {
    const nextCursors = reset ? {} : cursors;
    if (reset) {
      setAutoLoad(true);
      setProgress(null);
    }
    startTransition(async () => {
      const res = await searchAction(f, nextCursors);
      if (!res.ok) {
        setAutoLoad(false);
        toast.error((t.common.errors as Record<string, string>)[res.error] ?? t.common.errors.unexpected);
        return;
      }
      const pageResults = res.data.pages.flatMap((p) => p.results);
      setRaw((prev) => (reset ? pageResults : [...prev, ...pageResults.filter((r) => !prev.some((x) => x.provider === r.provider && x.externalId === r.externalId))]));
      const c: Partial<Record<DiscoveryProvider, string | null>> = reset ? {} : { ...cursors };
      const n: Partial<Record<DiscoveryProvider, string>> = reset ? {} : { ...notices };
      for (const p of res.data.pages) {
        c[p.provider] = p.nextCursor;
        if (p.progress) setProgress(p.progress);
        if (p.notice) n[p.provider] = p.notice;
      }
      for (const p of f.providers) if (!(p in c)) c[p] = null;
      setCursors(c);
      setNotices(n);
      setErrors(res.data.errors);
      setExisting((prev) => ({ ...(reset ? {} : prev), ...res.data.existing }));
      if (reset) setSelected(new Set());
      setSearched(true);
      if (reset && activeSaved) void touchSavedSearchAction(activeSaved, pageResults.length);
    });
  }

  function applySaved(s: Saved) {
    setActiveSaved(s.id);
    setText(s.filters.text ?? "");
    setIndustries(s.filters.industries ?? []);
    setLocations(s.filters.locations ?? []);
    setRadiusKm(s.filters.radiusKm ?? 8);
    setProviders(s.filters.providers.filter((p) => props.providers[p] !== "disabled"));
    setRequireWebsite(!!s.filters.requireWebsite);
    setRequirePhone(!!s.filters.requirePhone);
    setActiveOnly(s.filters.activeOnly !== false);
    setKvkType(s.filters.kvkType ?? "any");
    run(true, { ...s.filters, providers: s.filters.providers.filter((p) => props.providers[p] !== "disabled") });
  }

  const isInDb = (m: MergedResult) =>
    m.sources.some((s) => existing[`${s.provider}:${s.externalId}`] || (s.kvkNumber && existing[`kvk:${s.kvkNumber}`]));

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectable = merged.filter((m) => !isInDb(m));
  const allSelected = selectable.length > 0 && selectable.every((m) => selected.has(m.key));

  function doImport() {
    const groups = merged.filter((m) => selected.has(m.key)).map((m) => ({ sources: m.sources.map((s) => ({ provider: s.provider, externalId: s.externalId })) }));
    if (groups.length === 0) return;
    startImport(async () => {
      const res = await importAction(groups, listId === "none" ? null : listId);
      if (!res.ok && res.error === "import_over_credits") {
        toast.error(fmt(d.importOverCredits, { count: groups.length, remaining: res.fieldErrors?.remaining?.[0] ?? "0" }));
        return;
      }
      if (!res.ok) {
        toast.error((t.common.errors as Record<string, string>)[res.error] ?? t.common.errors.unexpected);
        return;
      }
      if (res.data.queued) {
        toast.success(fmt(d.importQueued, { count: res.data.queued }));
      } else if (res.data.outcomes) {
        const o = res.data.outcomes;
        const created = o.filter((x) => x.status === "created").length;
        const mergedCount = o.filter((x) => x.status === "merged").length;
        const failed = o.filter((x) => x.status === "failed").length;
        (failed ? toast.warning : toast.success)(fmt(d.importDone, { created, merged: mergedCount, failed }));
        const add: Record<string, string> = {};
        merged.filter((m) => selected.has(m.key)).forEach((m, i) => {
          const id = o[i]?.businessId;
          if (id) m.sources.forEach((s) => (add[`${s.provider}:${s.externalId}`] = id));
        });
        setExisting((prev) => ({ ...prev, ...add }));
      }
      setSelected(new Set());
    });
  }

  const hasGoogle = merged.some((m) => m.sources.some((s) => s.provider === "google_places"));

  useEffect(() => {
    if (peeking.current) return;
    const todo = merged.filter((m) => m.primary.website && !(m.key in peeked)).slice(0, 20);
    if (!todo.length) return;
    peeking.current = true;
    const pendingMarks = Object.fromEntries(todo.map((m) => [m.key, "pending" as const]));
    void (async () => {
      setPeeked((p) => ({ ...p, ...pendingMarks }));
      const r = await peekEmailsAction(todo.map((m) => ({ key: m.key, website: m.primary.website! }))).catch(() => null);
      const found = r && r.ok ? r.data : {};
      setPeeked((p) => ({ ...p, ...Object.fromEntries(todo.map((m) => [m.key, found[m.key] ?? []])) }));
      peeking.current = false;
    })();
  }, [merged, peeked]);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* ------------------------------------------------ filter panel */}
      <div className="space-y-4">
        <Card className="gap-0 p-4">
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              setActiveSaved(null);
              run(true);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="q">{d.query}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
                <Input id="q" value={text} onChange={(e) => setText(e.target.value)} placeholder={d.queryPlaceholder} className="pl-8" maxLength={120} />
              </div>
            </div>

            <IndustryPicker options={props.industries} value={industries} onChange={setIndustries} />

            <LocationPicker value={locations} onChange={setLocations} />

            {locations.some((l) => l.type === "city" || l.type === "postcode" || l.type === "municipality") && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <Label>{d.radius}</Label>
                  <span className="text-muted-foreground tabular">{radiusKm} km</span>
                </div>
                <Slider min={1} max={50} step={1} value={[radiusKm]} onValueChange={(v) => setRadiusKm(v[0])} />
              </div>
            )}

            <div className="space-y-2">
              <Label>{d.sources}</Label>
              <div className="space-y-1.5">
                {PROVIDERS.filter((p) => props.providers[p] !== "disabled").map((p) => {
                  const status = props.providers[p];
                  return (
                    <label key={p} className={cn("flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm", status === "disabled" && "opacity-50")}>
                      <Checkbox
                        checked={providers.includes(p)}
                        disabled={status === "disabled"}
                        onCheckedChange={(c) => setProviders((prev) => (c ? [...prev, p] : prev.filter((x) => x !== p)))}
                      />
                      <span className="flex-1">{PROVIDER_LABEL[p]}</span>
                      <Badge variant={status === "live" ? "success" : status === "test" ? "secondary" : status === "mock" ? "mock" : "outline"}>
                        {d.status[status]}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <Label>{d.filters}</Label>
              <ToggleRow label={d.onlyWebsite} checked={requireWebsite} onChange={setRequireWebsite} />
              <ToggleRow label={d.onlyPhone} checked={requirePhone} onChange={setRequirePhone} />
              <ToggleRow label={d.activeOnly} checked={activeOnly} onChange={setActiveOnly} />
              {providers.includes("kvk") && (
                <Select value={kvkType} onValueChange={setKvkType}>
                  <SelectTrigger size="sm"><SelectValue placeholder={d.kvkType} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{d.kvkTypeAny}</SelectItem>
                    {Object.entries(d.kvkTypes).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={pending || providers.length === 0}>
                {pending ? <Loader2 className="animate-spin" /> : <Search />}
                {pending ? d.searching : d.search}
              </Button>
              <Button type="button" variant="outline" size="icon" title={d.saveSearch} onClick={() => setSaveOpen(true)} disabled={!props.canWrite}>
                <Bookmark />
              </Button>
            </div>
          </form>
        </Card>

        <Card className="gap-0 p-4">
          <p className="mb-3 text-sm font-semibold">{d.savedSearches}</p>
          {props.savedSearches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{d.noSavedSearches}</p>
          ) : (
            <ul className="space-y-1">
              {props.savedSearches.map((s) => (
                <li key={s.id} className={cn("group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent", activeSaved === s.id && "bg-primary-soft")}>
                  <button type="button" className="flex-1 truncate text-left" onClick={() => applySaved(s)}>
                    {s.name}
                    {s.last_result_count != null && <span className="ml-1.5 text-xs text-muted-foreground">({s.last_result_count})</span>}
                  </button>
                  {props.canWrite && (
                    <button type="button" className="opacity-0 group-hover:opacity-100" onClick={() => startTransition(async () => void (await deleteSavedSearchAction(s.id)))} aria-label={t.common.delete}>
                      <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">{d.disclaimer}</p>
      </div>

      {/* ------------------------------------------------ results */}
      <div className="min-w-0 space-y-3">
        {Object.entries(notices).filter(([, n]) => n && n !== "mock").length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(notices).filter(([, n]) => n && n !== "mock").map(([p, n]) => (
              <span key={p} className="rounded-md border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{PROVIDER_LABEL[p as DiscoveryProvider]}:</span>{" "}
                {(d.notices as Record<string, string>)[n!] ?? n}
              </span>
            ))}
          </div>
        )}
        {errors.map((e) => (
          <div key={e.provider} className="rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2 text-sm">
            {fmt(d.providerError, { provider: PROVIDER_LABEL[e.provider] })}
          </div>
        ))}

        {!searched ? (
          <EmptyState icon={Building2} title={d.emptyTitle} description={d.emptyText} />
        ) : merged.length === 0 && !pending ? (
          <EmptyState icon={Search} title={d.noResultsTitle} description={d.noResultsText} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">{fmt(d.results, { count: merged.length })}</span>
                {autoLoading && (
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {progress ? fmt(d.searchingProgress, { done: progress.done, total: progress.total }) : d.searchingArea}
                    <button type="button" className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 hover:bg-accent" onClick={() => setAutoLoad(false)}>
                      <Square className="size-3" />{d.stop}
                    </button>
                  </span>
                )}
              </div>
              {props.canWrite && (
                <div className="flex items-center gap-2">
                  <Select value={listId} onValueChange={setListId}>
                    <SelectTrigger size="sm" className="w-44"><SelectValue placeholder={d.importInto} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{d.noList}</SelectItem>
                      {props.lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={selected.size === 0 || importing} onClick={doImport}>
                    {importing ? <Loader2 className="animate-spin" /> : <Check />}
                    {importing ? d.importing : fmt(d.importSelected, { count: selected.size })}
                  </Button>
                </div>
              )}
            </div>

            <div>
              <Card className="gap-0 overflow-hidden p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <Checkbox
                          checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                          onCheckedChange={(c) => setSelected(c ? new Set(selectable.map((m) => m.key)) : new Set())}
                          aria-label={t.common.selectAll}
                          disabled={!props.canWrite}
                        />
                      </TableHead>
                      <TableHead>{d.columns.business}</TableHead>
                      <TableHead>{d.columns.address}</TableHead>
                      <TableHead>{d.columns.contact}</TableHead>
                      <TableHead>{d.columns.rating}</TableHead>
                      <TableHead>{d.columns.sources}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {merged.map((m) => {
                      const r = m.primary;
                      const inDb = isInDb(m);
                      const dbId = m.sources.map((s) => existing[`${s.provider}:${s.externalId}`] ?? (s.kvkNumber ? existing[`kvk:${s.kvkNumber}`] : undefined)).find(Boolean);
                      return (
                        <TableRow key={m.key} data-state={selected.has(m.key) ? "selected" : undefined}>
                          <TableCell>
                            <Checkbox checked={selected.has(m.key)} disabled={inDb || !props.canWrite} onCheckedChange={() => toggle(m.key)} aria-label={r.name} />
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{r.name}</span>
                              {r.isMock && <Badge variant="mock">{t.mock.label}</Badge>}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              {r.industry && <span>{props.industries.find((i) => i.key === r.industry)?.label}</span>}
                              {inDb && dbId && <Link href={`/leads/${dbId}`} className="font-medium text-primary hover:underline">{d.alreadyInDb} →</Link>}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[220px] text-sm text-muted-foreground">
                            <div className="flex items-start gap-1.5">
                              <MapPin className="mt-0.5 size-3.5 shrink-0" />
                              <span className="leading-snug">
                                {(r.address.street || r.address.houseNumber) && (
                                  <span className="block whitespace-nowrap">{[r.address.street, r.address.houseNumber].filter(Boolean).join(" ")}</span>
                                )}
                                <span className="block whitespace-nowrap">{[formatPostalCode(r.address.postalCode), r.address.city].filter(Boolean).join(" ") || "—"}</span>
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.website && (
                              <a href={r.website} target="_blank" rel="noopener noreferrer nofollow" className="flex max-w-[200px] items-center gap-1.5 truncate text-primary hover:underline">
                                <Globe className="size-3.5 shrink-0" />{r.website.replace(/^https?:\/\/(www\.)?/, "")}
                              </a>
                            )}
                            {(() => {
                              const pe = peeked[m.key];
                              if (pe === "pending") return <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" />{d.emailLooking}</span>;
                              if (pe && pe.length) return <span className="mt-0.5 flex max-w-[220px] items-center gap-1.5 truncate"><AtSign className="size-3.5 shrink-0 text-muted-foreground" />{pe[0]}{pe.length > 1 && <span className="text-xs text-muted-foreground">+{pe.length - 1}</span>}</span>;
                              return null;
                            })()}
                            {r.phone && <span className="mt-0.5 flex items-center gap-1.5 text-muted-foreground"><Phone className="size-3.5" />{r.phone}</span>}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.rating != null && (
                              <span className="inline-flex items-center gap-1 tabular"><Star className="size-3.5 fill-amber-400 text-amber-400" />{r.rating.toFixed(1)} <span className="text-muted-foreground">({r.reviewCount})</span></span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {m.sources.map((s) => <Badge key={s.provider + s.externalId} variant="secondary">{t.providers[s.provider]}</Badge>)}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {hasGoogle && <>{d.attributionGoogle} · </>}
                {d.attributionOsm}
              </p>
              {hasMore && !autoLoading && (
                <Button variant="outline" size="sm" onClick={() => run(false)} disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" /> : <ChevronDown />}
                  {d.loadMore}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{d.saveSearch}</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="save-name">{d.saveSearchName}</Label>
            <Input id="save-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={120} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>{t.common.cancel}</Button>
            <Button
              disabled={!saveName.trim() || pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await saveSearchAction(saveName, filters());
                  if (res.ok) {
                    toast.success(t.common.saved);
                    setSaveOpen(false);
                    setSaveName("");
                    setActiveSaved(res.data.id);
                  } else toast.error((t.common.errors as Record<string, string>)[res.error] ?? t.common.errors.unexpected);
                })
              }
            >
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

type IndustryOption = { key: string; label: string; group: string; aliases: string[] };

function IndustryPicker({ options, value, onChange }: { options: IndustryOption[]; value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle) || o.group.toLowerCase().includes(needle) || o.aliases.some((a) => a.includes(needle)))
    : options;
  const groups = [...new Set(filtered.map((o) => o.group))];
  return (
    <div className="space-y-1.5">
      <Label>{t.discover.industries}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between font-normal">
            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
              {value.length === 0 ? t.discover.industriesPlaceholder : value.map((k) => options.find((o) => o.key === k)?.label).join(", ")}
            </span>
            <ChevronDown className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(380px,calc(100vw-2rem))] p-0" align="start">
          <div className="border-b p-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.discover.industrySearch} className="h-8" autoFocus />
          </div>
          <div className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain p-1" onWheel={(e) => e.stopPropagation()}>
            {groups.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{t.discover.industryNoMatch}</p>}
            {groups.map((g) => (
              <div key={g} className="pb-1">
                <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g}</p>
                {filtered.filter((o) => o.group === g).map((o) => {
                  const on = value.includes(o.key);
                  return (
                    <button
                      type="button"
                      key={o.key}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => onChange(on ? value.filter((v) => v !== o.key) : [...value, o.key].slice(0, 10))}
                    >
                      <Checkbox checked={on} className="pointer-events-none" tabIndex={-1} />
                      {o.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function LocationPicker({ value, onChange }: { value: LocationFilter[]; onChange: (v: LocationFilter[]) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const whole = value.some((v) => v.type === "nl");

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return;
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/locations/suggest?q=${encodeURIComponent(q.trim())}`);
        const json = (await res.json()) as { results: Suggestion[] };
        setSuggestions(json.results ?? []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [q]);

  const typeLabel: Record<Suggestion["type"], string> =
    t.meta.locale === "nl" ? { provincie: "Provincie", gemeente: "Gemeente", woonplaats: "Plaats", postcode: "Postcode" } : { provincie: "Province", gemeente: "Municipality", woonplaats: "City", postcode: "Postcode" };

  return (
    <div className="space-y-1.5">
      <Label>{t.discover.location}</Label>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t.discover.wholeCountry}</span>
        <Switch checked={whole} onCheckedChange={(c) => onChange(c ? [{ type: "nl" }] : [])} />
      </label>
      {!whole && (
        <Popover open={open && q.trim().length >= 2 && suggestions.length > 0} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div className="relative">
              <MapPin className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.discover.locationPlaceholder} className="pl-8" disabled={value.length >= 5} />
              {loading && <Loader2 className="absolute top-2.5 right-2.5 size-4 animate-spin text-muted-foreground" />}
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
            {suggestions.map((s) => (
              <button
                type="button"
                key={s.id}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onChange([...value, { type: TYPE_MAP[s.type] as "city", name: s.name, lat: s.lat, lng: s.lng }]);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="truncate">{s.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{typeLabel[s.type]}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      {!whole && value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {value.map((l, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
              {"name" in l ? l.name : t.discover.wholeCountry}
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t.common.delete}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { assignBusinessAction, setLeadStatusAction, setTagsAction } from "../actions";

export function ProfileControls(props: { businessId: string; status: string; assignedTo: string | null; tags: string[]; members: { id: string; name: string }[]; canWrite: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tags, setTags] = useState(props.tags);
  const [tagInput, setTagInput] = useState("");
  const done = (r: { ok: boolean }) => {
    if (r.ok) router.refresh();
    else toast.error(t.common.errors.unexpected);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={props.status} disabled={!props.canWrite || pending} onValueChange={(v) => start(async () => done(await setLeadStatusAction([props.businessId], v)))}>
        <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(t.leadStatus).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={props.assignedTo ?? "none"} disabled={!props.canWrite || pending} onValueChange={(v) => start(async () => done(await assignBusinessAction(props.businessId, v === "none" ? null : v)))}>
        <SelectTrigger size="sm" className="w-44"><SelectValue placeholder={t.leads.profile.assign} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t.leads.profile.unassigned}</SelectItem>
          {props.members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs">
            {tag}
            {props.canWrite && (
              <button aria-label={t.common.delete} onClick={() => { const n = tags.filter((x) => x !== tag); setTags(n); start(async () => done(await setTagsAction(props.businessId, n))); }}>
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {props.canWrite && (
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tagInput.trim()) {
                e.preventDefault();
                const n = [...new Set([...tags, tagInput.trim()])];
                setTags(n);
                setTagInput("");
                start(async () => done(await setTagsAction(props.businessId, n)));
              }
            }}
            placeholder={`+ ${t.leads.tags}`}
            className="h-7 w-24 text-xs"
          />
        )}
      </div>
    </div>
  );
}

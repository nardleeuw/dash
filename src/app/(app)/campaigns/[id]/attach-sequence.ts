"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/server/auth";
import { createClient } from "@/server/supabase/server";

/** Attach a (newly created) follow-up sequence to a draft or paused campaign. */
export async function attachSequenceAction(campaignId: unknown, sequenceId: unknown) {
  const ws = await requireRole("manager");
  const c = z.string().uuid().parse(campaignId);
  const s = z.string().uuid().parse(sequenceId);
  const supabase = await createClient();
  await supabase.from("campaigns").update({ follow_up_sequence_id: s }).eq("id", c).eq("org_id", ws.org.id).in("status", ["draft", "paused", "scheduled"]);
  revalidatePath(`/campaigns/${c}`);
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AgencyProfile = {
  id: string;
  client_id: string | null;
  agency_name: string;
  website: string | null;
  description: string | null;
  services: { name: string; description?: string | null; ideal_for?: string | null }[];
  products: string | null;
  target_industries: string[];
  ideal_customer_profile: string | null;
  unique_selling_proposition: string | null;
  tone_of_voice: string | null;
  writing_style: string | null;
  language: "nl" | "en";
  email_length: "short" | "medium" | "long";
  personalization?: "subtle" | "balanced" | "strong";
  formality?: "formal" | "informal";
  call_to_action: string | null;
  example_emails: string[];
  avoid_phrases: string[];
  sender_name: string | null;
  sender_title: string | null;
  signature: string | null;
};

export async function loadAgencyProfile(db: SupabaseClient, orgId: string, profileId?: string | null): Promise<AgencyProfile | null> {
  let q = db.from("agency_profiles").select("*").eq("org_id", orgId);
  q = profileId ? q.eq("id", profileId) : q.is("client_id", null);
  const { data } = await q.maybeSingle();
  return (data as AgencyProfile) ?? null;
}

export type OrgSettings = {
  scoring_weights?: Record<string, number>;
  target_provinces?: string[];
  compliance?: Record<string, unknown>;
  sending?: Record<string, unknown>;
};

export async function loadOrgSettings(db: SupabaseClient, orgId: string): Promise<{ settings: OrgSettings; locale: "nl" | "en"; name: string }> {
  const { data } = await db.from("organizations").select("settings, locale, name").eq("id", orgId).single();
  return { settings: (data?.settings ?? {}) as OrgSettings, locale: data?.locale === "en" ? "en" : "nl", name: data?.name ?? "" };
}

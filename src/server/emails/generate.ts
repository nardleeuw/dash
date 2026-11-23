import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/server/supabase/admin";
import { structured, AiUnavailableError } from "@/server/ai/client";
import { emailSchema, emailSystemPrompt, emailUserPrompt, EMAIL_PROMPT_VERSION } from "@/server/ai/prompts/email";
import { loadAgencyProfile, type AgencyProfile } from "@/server/agency";
import { consumeCredits, CreditsExhaustedError } from "@/server/usage";
import { runResearch } from "@/server/research/run";
import { findBusinessEmails } from "@/server/contacts/finder";
import type { BatchOptions } from "./batch";
import { industryLabel } from "@/config/industries";
import { factCheckEmail, personalizationScore } from "./fact-check";
import { mockEmail } from "./mock-writer";
import { pickRecipient, type ContactCandidate } from "./recipient";
import { evaluateEmailCompliance } from "@/server/compliance/evaluate";

const RESEARCH_MAX_AGE_DAYS = 30;

type Obs = { text: string; quote: string; source_url: string };
type Opp = { id: string; type: string; title: string; description: string; evidence: { kind: string; text: string; quote?: string | null; source_url?: string | null }[]; is_verified: boolean; confidence: number; recommended_service: string | null };

export class RetryableGenerationError extends Error {}

async function ensureResearch(orgId: string, businessId: string, hasWebsite: boolean) {
  const admin = createAdminClient();
  const since = new Date(Date.now() - RESEARCH_MAX_AGE_DAYS * 86_400_000).toISOString();
  const { data: latest } = await admin
    .from("website_analyses")
    .select("id, status, research, signals, completed_at")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(5);
  const fresh = latest?.find((a) => ["completed", "no_website", "blocked"].includes(a.status) && (a.completed_at ?? "") >= since);
  if (fresh) return fresh;
  const active = latest?.find((a) => a.status === "queued" || a.status === "running");
  if (active) return latest?.find((a) => a.status === "completed") ?? null;
  // Research this specific business now (each email gets its own research).
  const { data: created } = await admin.from("website_analyses").insert({ org_id: orgId, business_id: businessId, url: "", status: "queued" }).select("id").single();
  if (!created) return null;
  await runResearch({ orgId, userId: null, businessId, analysisId: created.id });
  void hasWebsite;
  const { data: done } = await admin.from("website_analyses").select("id, status, research, signals, completed_at").eq("id", created.id).single();
  return done;
}

async function latestResearch(orgId: string, businessId: string) {
  const { data } = await createAdminClient()
    .from("website_analyses")
    .select("id, status, research, signals, completed_at")
    .eq("org_id", orgId)
    .eq("business_id", businessId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export function chooseOpportunity(opps: Opp[], agency: AgencyProfile | null): Opp | null {
  const sorted = [...opps].sort((a, b) =>
    Number(b.is_verified) - Number(a.is_verified) ||
    Number(!!b.recommended_service) - Number(!!a.recommended_service) ||
    Number(b.confidence) - Number(a.confidence));
  void agency;
  return sorted[0] ?? null;
}

/** Generate (or regenerate) one individually researched email. Idempotent per version. */
export async function generateEmailById(orgId: string, emailId: string) {
  const admin = createAdminClient();
  const { data: email } = await admin.from("generated_emails").select("*").eq("id", emailId).eq("org_id", orgId).maybeSingle();
  if (!email) return { status: "missing" };
  if (email.generation_status === "completed" || email.generation_status === "skipped") return { status: email.generation_status };

  const setStatus = (generation_status: string, extra: Record<string, unknown> = {}) =>
    admin.from("generated_emails").update({ generation_status, ...extra }).eq("id", emailId);

  // Claim the email (queued → researching) so two workers never generate it twice.
  const { data: claimed } = await admin
    .from("generated_emails")
    .update({ generation_status: "researching", attempts: (email.attempts ?? 0) + 1, error: null })
    .eq("id", emailId)
    .eq("generation_status", "queued")
    .select("id");
  if (!claimed?.length) return { status: "busy" };

  try {
    await consumeCredits({ orgId, kind: "email_generation", idempotencyKey: `gen:${emailId}:v${email.version}`, referenceType: "generated_email", referenceId: emailId });
  } catch (err) {
    if (err instanceof CreditsExhaustedError) {
      await setStatus("failed", { error: "credits_exhausted" });
      return { status: "failed" };
    }
    throw err;
  }

  const { data: batchRow } = email.batch_id
    ? await admin.from("email_generation_batches").select("options").eq("id", email.batch_id).maybeSingle()
    : { data: null };
  const options = (batchRow?.options ?? {}) as BatchOptions;

  // Find an address first when the business has none (website → Hunter → verified web search).
  if (options.findEmails !== false) {
    const { count } = await admin.from("contacts").select("id", { count: "exact", head: true }).eq("business_id", email.business_id).not("email", "is", null);
    if (!count) {
      try {
        await findBusinessEmails(orgId, null, email.business_id);
      } catch (err) {
        console.error("[emails] address lookup failed", email.business_id, (err as Error).message);
      }
    }
  }

  const [{ data: b }, agency, { data: contacts }] = await Promise.all([
    admin.from("businesses").select("*").eq("id", email.business_id).single(),
    loadAgencyProfile(admin, orgId, email.agency_profile_id),
    admin.from("contacts").select("id, email, full_name, first_name, job_title, email_type, email_verification, is_primary").eq("business_id", email.business_id),
  ]);
  if (!b || !agency) {
    await setStatus("failed", { error: "missing_business_or_profile" });
    return { status: "failed" };
  }

  // AI research is optional per batch; without it we still use earlier research if present.
  const analysis = options.research === false ? await latestResearch(orgId, b.id) : await ensureResearch(orgId, b.id, !!b.website_url);
  const research = (analysis?.research ?? {}) as { observations?: Obs[]; hypotheses?: { text: string }[]; summary?: string };
  const { data: oppRows } = await admin.from("opportunities").select("*").eq("business_id", b.id).eq("status", "open");
  const opportunity = chooseOpportunity((oppRows ?? []) as Opp[], agency);

  const contact = email.contact_id
    ? ((contacts ?? []) as ContactCandidate[]).find((c) => c.id === email.contact_id) ?? null
    : pickRecipient((contacts ?? []) as ContactCandidate[]);
  const generic = !contact || contact.email_type !== "personal";
  const recipientName = !generic ? contact?.full_name ?? null : null;

  // Previous step's email (for follow-ups).
  let previous: { subject: string; body: string } | null = null;
  if (email.sequence_step > 0) {
    const { data: prev } = await admin
      .from("generated_emails")
      .select("subject, body")
      .eq("org_id", orgId)
      .eq("business_id", b.id)
      .eq("agency_profile_id", email.agency_profile_id)
      .eq("sequence_step", email.sequence_step - 1)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    previous = prev?.subject ? { subject: prev.subject, body: prev.body ?? "" } : null;
  }

  const company = {
    name: b.name, legal_form: b.legal_form, city: b.city, province: b.province,
    industry: industryLabel(b.industry, agency.language), website: b.website_url,
  };
  const observations = (research.observations ?? []).slice(0, 8);
  const hypotheses = (research.hypotheses ?? []).slice(0, 5);
  const signals = (analysis?.signals ?? null) as Record<string, unknown> | null;
  const signalSummary = signals ? Object.fromEntries(Object.entries(signals).filter(([k, v]) => typeof v === "boolean" || k === "cms" || k === "copyrightYear")) : null;

  await setStatus("generating");
  let output;
  let model: string;
  let isMock = b.is_mock as boolean;
  try {
    const res = await structured({
      task: "email",
      orgId,
      system: emailSystemPrompt(agency),
      user: emailUserPrompt({
        agency, company, recipient: { name: recipientName, role: !generic ? contact?.job_title ?? null : null, generic },
        opportunity: opportunity ? { title: opportunity.title, description: opportunity.description, recommended_service: opportunity.recommended_service, evidence: opportunity.evidence } : null,
        observations, hypotheses, signals: signalSummary, researchSummary: research.summary ?? null,
        websiteExcerpt: observations.map((o) => o.quote).join("\n"), extraInstructions: (email.opportunity as { instructions?: string } | null)?.instructions ?? null,
        sequenceStep: email.sequence_step, previousEmail: previous,
      }),
      schema: emailSchema,
      schemaName: "personalized_email",
      maxOutputTokens: 2500,
      mock: () => mockEmail({ agency, companyName: b.name, recipientName, opportunity, observations, sequenceStep: email.sequence_step }),
    });
    output = res.data;
    model = res.model;
    isMock = isMock || res.isMock;
  } catch (err) {
    if (err instanceof AiUnavailableError && err.reason === "quota") {
      await setStatus("failed", { error: "ai_quota" });
      return { status: "failed" };
    }
    await setStatus("failed", { error: (err as Error).message?.slice(0, 300) ?? "ai_error" });
    if ((email.attempts ?? 0) + 1 < 3) throw new RetryableGenerationError((err as Error).message);
    return { status: "failed" };
  }

  // Fact-check against exactly the material the writer was allowed to use.
  const sourceTexts = [
    ...observations.flatMap((o) => [o.text, o.quote]),
    ...(opportunity?.evidence ?? []).flatMap((e) => [e.text, e.quote ?? ""]),
    opportunity?.title ?? "", opportunity?.description ?? "",
    JSON.stringify(company), JSON.stringify(signalSummary ?? {}),
    recipientName ?? "", contact?.job_title ?? "",
  ];
  const agencyTexts = [JSON.stringify(agency.services), agency.description ?? "", agency.unique_selling_proposition ?? "", agency.products ?? "", agency.signature ?? "", agency.call_to_action ?? ""];
  const check = factCheckEmail({
    subject: output.subject, body: output.body, evidence: output.personalization_evidence, sourceTexts,
    hypotheses: hypotheses.map((h) => h.text), companyName: b.name, agencyWebsite: agency.website, agencyTexts,
    avoidPhrases: agency.avoid_phrases, length: agency.email_length,
  });

  // Keep the previous version for history when regenerating.
  if (email.body) {
    await admin.from("generated_email_revisions").insert({ org_id: orgId, generated_email_id: emailId, version: email.version, subject: email.subject, body: email.body, reason: "regenerated" });
  }
  const inputHash = createHash("sha256").update(JSON.stringify({ company, observations, opportunity: opportunity?.id, agency: agency.id })).digest("hex");
  await admin
    .from("generated_emails")
    .update({
      contact_id: contact?.id ?? null,
      recipient_email: contact?.email ?? null,
      language: agency.language,
      research_summary: research.summary ?? null,
      opportunity_id: opportunity?.id ?? null,
      opportunity: opportunity ? { title: opportunity.title, type: opportunity.type, is_verified: opportunity.is_verified, recommended_service: opportunity.recommended_service } : null,
      personalization_evidence: check.claims,
      personalization_score: personalizationScore(output.personalization_score, check),
      fact_check: { passed: check.passed, issues: check.issues, injection: output.injection_attempt_detected },
      subject: output.subject.slice(0, 200),
      body: output.body.slice(0, 8000),
      alt_subject: output.alt_subject.slice(0, 200),
      alt_body: output.alt_body.slice(0, 8000),
      generation_status: "completed",
      review_status: "pending",
      compliance_status: "unchecked",
      compliance_reasons: [],
      error: null,
      model,
      prompt_version: EMAIL_PROMPT_VERSION,
      input_hash: inputHash,
      is_mock: isMock,
      version: email.body ? email.version + 1 : email.version,
      approved_by: null,
      approved_at: null,
      rejected_reason: null,
    })
    .eq("id", emailId);
  await evaluateEmailCompliance(orgId, emailId);
  await admin.from("activities").insert({ org_id: orgId, business_id: b.id, type: "email_generated", data: { email_id: emailId, step: email.sequence_step, passed: check.passed } });
  return { status: "completed", passed: check.passed };
}

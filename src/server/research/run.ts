import "server-only";
import { acceptableForBusiness } from "@/server/contacts/emails";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/server/supabase/admin";
import { consumeCredits, CreditsExhaustedError } from "@/server/usage";
import { structured, AiUnavailableError } from "@/server/ai/client";
import { researchSchema, researchSystemPrompt, researchUserPrompt, RESEARCH_PROMPT_VERSION } from "@/server/ai/prompts/research";
import { detectInjection } from "@/server/ai/sanitize";
import { loadAgencyProfile, loadOrgSettings } from "@/server/agency";
import { recomputeBusiness } from "@/server/discovery/import";
import { classifyEmail, extractDomain, normalizePhone } from "@/server/discovery/normalize";
import { scoreLead } from "@/server/scoring/score";
import { crawlWebsite, type CrawledPage } from "./crawler";
import { detectSignals, type WebsiteSignals } from "./signals";
import { matchService, ruleOpportunities, type Opportunity } from "./opportunities";
import { mergeOpportunities, validateResearch, type ValidatedResearch } from "./validate";
import { mockResearch } from "./mock-ai";
import { dispatch } from "@/server/jobs/dispatch";

/** Queue research for businesses; one active analysis per business. */
export async function requestResearch(orgId: string, userId: string | null, businessIds: string[]) {
  const admin = createAdminClient();
  const { data: businesses } = await admin.from("businesses").select("id, website_url").eq("org_id", orgId).in("id", businessIds);
  let queued = 0;
  let skipped = 0;
  for (const b of businesses ?? []) {
    const { data, error } = await admin
      .from("website_analyses")
      .insert({ org_id: orgId, business_id: b.id, url: b.website_url ?? "", status: "queued", requested_by: userId })
      .select("id")
      .single();
    if (error) {
      skipped++; // already queued/running (unique active index)
      continue;
    }
    await dispatch("research/business.requested", { orgId, userId, businessId: b.id, analysisId: data.id });
    queued++;
  }
  return { queued, skipped };
}

function signalSummary(s: WebsiteSignals | null) {
  if (!s) return null;
  return {
    reachable: s.reachable, https: s.https, mobile: s.mobileViewport, booking: s.hasOnlineBooking, ordering: s.hasOnlineOrdering,
    contact_form: s.hasContactForm, quote_form: s.hasQuoteForm, chat: s.hasLiveChat || s.hasWhatsApp, analytics: s.hasAnalytics,
    outdated: s.outdatedCopyright, cms: s.cms,
  };
}

export async function runResearch({ orgId, userId, businessId, analysisId }: { orgId: string; userId: string | null; businessId: string; analysisId: string }) {
  const admin = createAdminClient();
  const { data: analysis } = await admin.from("website_analyses").select("id, status").eq("id", analysisId).eq("org_id", orgId).maybeSingle();
  if (!analysis || analysis.status === "completed") return { skipped: true };

  const fail = async (status: "failed" | "blocked" | "no_website", error: string) => {
    await admin.from("website_analyses").update({ status, error, completed_at: new Date().toISOString() }).eq("id", analysisId);
  };

  try {
    await consumeCredits({ orgId, kind: "research", idempotencyKey: `research:${analysisId}`, userId, referenceType: "website_analysis", referenceId: analysisId });
  } catch (err) {
    if (err instanceof CreditsExhaustedError) {
      await fail("failed", "credits_exhausted");
      return { error: "credits" };
    }
    throw err;
  }
  await admin.from("website_analyses").update({ status: "running", started_at: new Date().toISOString() }).eq("id", analysisId);

  const { data: b } = await admin.from("businesses").select("*").eq("id", businessId).eq("org_id", orgId).single();
  const { data: contacts } = await admin.from("contacts").select("email").eq("business_id", businessId);
  const [{ settings, locale }, agency] = await Promise.all([loadOrgSettings(admin, orgId), loadAgencyProfile(admin, orgId)]);

  let pages: CrawledPage[] = [];
  let signals: WebsiteSignals | null = null;
  let crawlNote: string | null = null;
  let finalStatus: "completed" | "blocked" | "no_website" = "completed";

  if (!b.website_url) {
    finalStatus = "no_website";
  } else {
    const crawl = await crawlWebsite(b.website_url);
    if (crawl.status === "ok") {
      pages = crawl.pages;
      signals = detectSignals(pages);
    } else if (crawl.status === "blocked") {
      finalStatus = "blocked";
      crawlNote = `${crawl.reason}: ${crawl.detail}`;
    } else {
      crawlNote = crawl.reason;
      signals = { ...detectSignals([]), reachable: false };
    }
  }

  // ----- AI research (falls back to deterministic analysis if unavailable)
  let validated: ValidatedResearch | null = null;
  let model: string | null = null;
  let isMock = Boolean(b.is_mock);
  let aiError: string | null = null;
  if (pages.length > 0) {
    const pagePayload = pages.map((p) => ({ url: p.url, title: p.title, text: p.text.slice(0, 4000), headings: p.headings, metaDescription: p.metaDescription }));
    try {
      const res = await structured({
        task: "research",
        orgId,
        system: researchSystemPrompt(locale),
        user: researchUserPrompt({
          company: { name: b.name, legal_form: b.legal_form, industry: b.industry, sbi_codes: b.sbi_codes, city: b.city, employees: b.employee_range },
          agency: { name: agency?.agency_name ?? "", services: agency?.services ?? [], targetIndustries: agency?.target_industries ?? [] },
          signals: { ...signalSummary(signals), booking_providers: signals?.bookingProviders, chat_providers: signals?.chatProviders, copyright_year: signals?.copyrightYear },
          pages: pagePayload,
        }),
        schema: researchSchema,
        schemaName: "company_research",
        mock: () => mockResearch(pagePayload, signals, locale),
        maxOutputTokens: 5000,
      });
      validated = validateResearch(res.data, pages);
      model = res.model;
      isMock = isMock || res.isMock;
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      aiError = err.reason;
    }
  }

  const injectionHeuristic = pages.some((p) => detectInjection(p.text));
  const rules = ruleOpportunities(b.industry, signals, pages.map((p) => p.url), locale);
  const opportunities: Opportunity[] = mergeOpportunities(validated?.aiOpportunities ?? [], b.website_url ? rules : rules.slice(0, 1)).map((o) => ({
    ...o,
    recommended_service: o.recommended_service ?? matchService(o.type, agency?.services ?? []),
  }));

  // ----- persist analysis
  const contentHash = pages.length ? createHash("sha256").update(pages.map((p) => p.text).join("\n")).digest("hex") : null;
  await admin
    .from("website_analyses")
    .update({
      status: finalStatus,
      url: b.website_url ?? "",
      pages: pages.map((p) => ({ url: p.url, title: p.title, status: p.status, bytes: p.bytes, ms: p.ms })),
      signals: signals ?? {},
      performance: signals ? { avgResponseMs: signals.avgResponseMs, totalBytes: signals.totalBytes } : null,
      research: validated
        ? { ...validated, aiOpportunities: undefined, injectionDetected: validated.injectionDetected || injectionHeuristic, aiError, crawlNote }
        : { aiError, crawlNote, injectionDetected: injectionHeuristic },
      summary: validated?.summary ?? null,
      content_hash: contentHash,
      model,
      prompt_version: RESEARCH_PROMPT_VERSION,
      is_mock: isMock,
      error: crawlNote,
      completed_at: new Date().toISOString(),
    })
    .eq("id", analysisId);

  await admin.from("opportunities").delete().eq("business_id", businessId).eq("org_id", orgId).eq("status", "open").neq("analysis_id", analysisId);
  if (opportunities.length) {
    const { data: inserted } = await admin
      .from("opportunities")
      .insert(opportunities.map((o) => ({ org_id: orgId, business_id: businessId, analysis_id: analysisId, type: o.type, title: o.title, description: o.description, evidence: o.evidence, is_verified: o.is_verified, confidence: o.confidence, recommended_service: o.recommended_service })))
      .select("id");
    void inserted;
  }

  // ----- enrich the company record from what we verified on the website
  if (pages.length) {
    const siteText = pages.map((p) => p.text).join(" ").toLowerCase();
    const domain = extractDomain(b.website_url);
    const verified = (b.kvk_number && siteText.includes(b.kvk_number)) || (b.postal_code && siteText.replace(/\s/g, "").includes(String(b.postal_code).toLowerCase()));
    if (domain) {
      await admin.from("websites").update({ verification_status: verified ? "verified" : "unverified", verification_evidence: verified ? (b.kvk_number && siteText.includes(b.kvk_number) ? "kvk_number_on_site" : "postcode_on_site") : null }).eq("business_id", businessId).eq("domain", domain);
      if (verified) {
        await upsertAttr(admin, orgId, businessId, "website_url", b.website_url, "website_crawl");
      }
    }
    const phone = normalizePhone(signals?.phones[0]);
    if (phone) await upsertAttr(admin, orgId, businessId, "phone", phone, "website_crawl");
    if (validated?.summary && !isMock) await upsertAttr(admin, orgId, businessId, "description", validated.summary, "openai");

    // Emails published on the company's own website.
    const known = new Set((contacts ?? []).map((c) => (c.email ?? "").toLowerCase()));
    for (const email of signals?.emails ?? []) {
      if (known.has(email) || !acceptableForBusiness(email, domain, { publishedByBusiness: true })) continue;
      const type = classifyEmail(email);
      const { data: c } = await admin
        .from("contacts")
        .insert({
          org_id: orgId, business_id: businessId, email, source: "website_crawl", is_mock: isMock,
          email_type: type === "generic" ? "generic" : type === "personal" ? "personal" : "unknown",
          recipient_category: type === "generic" ? "legal_entity_generic" : "unknown",
        })
        .select("id")
        .single();
      if (c) {
        const page = pages.find((p) => p.emails.includes(email));
        await admin.from("contact_sources").insert({ org_id: orgId, contact_id: c.id, provider: "website_crawl", source_url: page?.url ?? b.website_url });
        known.add(email);
      }
    }
  }

  // ----- score
  const score = scoreLead({
    business: { industry: b.industry, province: b.province, website_url: b.website_url, phone: b.phone, kvk_number: b.kvk_number, hasEmailContact: (contacts ?? []).some((c) => c.email) || (signals?.emails.length ?? 0) > 0 },
    agency: { targetIndustries: agency?.target_industries ?? [], services: agency?.services ?? [], targetProvinces: settings.target_provinces ?? [] },
    signals,
    opportunities,
    weights: settings.scoring_weights,
    locale,
  });
  await admin.from("lead_scores").insert({ org_id: orgId, business_id: businessId, total: score.total, factors: score.factors, weights: score.weights, recommended_service: score.recommendedService, analysis_id: analysisId });
  await admin
    .from("businesses")
    .update({
      lead_score: score.total,
      score_updated_at: new Date().toISOString(),
      recommended_service: score.recommendedService,
      digital_signals: signalSummary(signals),
      last_researched_at: new Date().toISOString(),
      ...(b.lead_status === "new" ? { lead_status: "enriched" } : {}),
    })
    .eq("id", businessId);
  await recomputeBusiness(admin, orgId, businessId);
  await admin.from("activities").insert({ org_id: orgId, business_id: businessId, actor_id: userId, type: "research_completed", data: { score: score.total, opportunities: opportunities.length, status: finalStatus } });
  return { score: score.total, opportunities: opportunities.length, status: finalStatus };
}

async function upsertAttr(admin: ReturnType<typeof createAdminClient>, orgId: string, businessId: string, attribute: string, value: unknown, provider: "website_crawl" | "openai") {
  const { data: existing } = await admin.from("business_attributes").select("id").eq("business_id", businessId).eq("attribute", attribute).eq("provider", provider).is("location_id", null).maybeSingle();
  const row = { org_id: orgId, business_id: businessId, attribute, value: value as never, provider, retrieved_at: new Date().toISOString(), verification_status: provider === "website_crawl" ? "verified" : "unverified" };
  if (existing) await admin.from("business_attributes").update(row).eq("id", existing.id);
  else await admin.from("business_attributes").insert(row);
}

/** Re-score every researched business (e.g. after weights changed). */
export async function rescoreOrganization(orgId: string) {
  const admin = createAdminClient();
  const [{ settings, locale }, agency] = await Promise.all([loadOrgSettings(admin, orgId), loadAgencyProfile(admin, orgId)]);
  const { data: rows } = await admin
    .from("businesses")
    .select("id, industry, province, website_url, phone, kvk_number, contacts(email), website_analyses(id, signals, completed_at), opportunities(type, title, description, evidence, is_verified, confidence, recommended_service, status)")
    .eq("org_id", orgId)
    .not("last_researched_at", "is", null)
    .limit(5000);
  let n = 0;
  for (const r of rows ?? []) {
    const latest = (r.website_analyses as { id: string; signals: WebsiteSignals; completed_at: string | null }[]).filter((a) => a.completed_at).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))[0];
    const opps = (r.opportunities as (Opportunity & { status: string })[]).filter((o) => o.status === "open");
    const s = scoreLead({
      business: { industry: r.industry, province: r.province, website_url: r.website_url, phone: r.phone, kvk_number: r.kvk_number, hasEmailContact: (r.contacts as { email: string | null }[]).some((c) => c.email) },
      agency: { targetIndustries: agency?.target_industries ?? [], services: agency?.services ?? [], targetProvinces: settings.target_provinces ?? [] },
      signals: latest?.signals && Object.keys(latest.signals).length ? latest.signals : null,
      opportunities: opps,
      weights: settings.scoring_weights,
      locale,
    });
    await admin.from("lead_scores").insert({ org_id: orgId, business_id: r.id, total: s.total, factors: s.factors, weights: s.weights, recommended_service: s.recommendedService, analysis_id: latest?.id ?? null });
    await admin.from("businesses").update({ lead_score: s.total, score_updated_at: new Date().toISOString(), recommended_service: s.recommendedService }).eq("id", r.id);
    n++;
  }
  return { rescored: n };
}

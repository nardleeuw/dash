import "server-only";
import { createAdminClient } from "@/server/supabase/admin";
import { consumeCredits } from "@/server/usage";
import { getHunter } from "@/server/providers/registry-hunter";
import { ProviderError } from "@/server/providers/types";
import { providerMode } from "@/server/providers/mode";
import { structured, AiUnavailableError } from "@/server/ai/client";
import { classifyEmail } from "@/server/discovery/normalize";
import { crawlWebsite, fetchPublicPage } from "@/server/research/crawler";
import { acceptableForBusiness, emailDomain, FREE_MAIL_DOMAINS, normalizeEmail } from "./emails";
import { domainAcceptsMail } from "./mx";
import { pickRecipient, type ContactCandidate } from "@/server/emails/recipient";
import { sourceUrls, verifyFindings, webFindingsSchema, webSearchSystemPrompt, webSearchUserPrompt, type WebFindings } from "./web-search";

/**
 * "E-mailadressen zoeken": combines every source in a fixed order so each one
 * fills the gaps of the previous:
 *   1. the company's own website (contact/team/colofon pages, hidden addresses)
 *   2. Hunter domain search
 *   3. AI web search (OpenAI) — only when we still have fewer than 3 addresses;
 *      every suggestion is verified against the page it cites
 *   4. Hunter Email Finder for named decision makers found on the web
 *   5. DNS check: the address's domain must be able to receive mail
 * Found addresses are stored with their sources. Finding an address does NOT
 * make it eligible for outreach — see the compliance gate.
 */

export type ContactSourceKey = "website" | "hunter" | "web" | "finder";
export type FinderSummary = { added: number; total: number; bySource: Record<ContactSourceKey, number>; notes: string[] };

type Source = { provider: "website_crawl" | "hunter" | "openai" | "mock"; url: string | null; confidence?: number | null; detail?: Record<string, unknown> };
type Candidate = {
  email: string;
  origin: ContactSourceKey;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  title?: string | null;
  department?: string | null;
  linkedin?: string | null;
  hunterType?: "personal" | "generic";
  verification?: string | null;
  score?: number | null;
  sources: Source[];
};

export type FinderDeps = {
  crawl?: typeof crawlWebsite;
  fetchPage?: (url: string) => Promise<string | null>;
  acceptsMail?: (domain: string) => Promise<boolean>;
  webSearch?: (b: { name: string; city: string | null; website: string | null; domain: string | null }, orgId: string) => Promise<{ findings: WebFindings; isMock: boolean } | null>;
};

const VERIFICATION_MAP: Record<string, string> = { valid: "valid", invalid: "invalid", accept_all: "accept_all", webmail: "webmail", disposable: "disposable", unknown: "unknown" };
const MIN_FOR_WEB_SEARCH = 3;
const MAX_FINDER_LOOKUPS = 2;
const MIN_FINDER_SCORE = 70;

async function defaultWebSearch(b: { name: string; city: string | null; website: string | null; domain: string | null }, orgId: string) {
  if (providerMode("openai") === "disabled") return null;
  try {
    const res = await structured({
      task: "contacts",
      orgId,
      system: webSearchSystemPrompt(),
      user: webSearchUserPrompt(b),
      schema: webFindingsSchema,
      schemaName: "contact_findings",
      // Demo mode never invents people or addresses.
      mock: () => ({ emails: [], people: [] }),
      maxOutputTokens: 3000,
      webSearch: true,
    });
    return { findings: res.data, isMock: res.isMock };
  } catch (err) {
    if (err instanceof AiUnavailableError) return null;
    throw err;
  }
}

export async function findBusinessEmails(orgId: string, userId: string | null, businessId: string, deps: FinderDeps = {}): Promise<FinderSummary | { error: "not_found" | "no_sources" }> {
  const crawl = deps.crawl ?? crawlWebsite;
  const fetchPage = deps.fetchPage ?? ((u: string) => fetchPublicPage(u));
  const acceptsMail = deps.acceptsMail ?? domainAcceptsMail;
  const webSearch = deps.webSearch ?? defaultWebSearch;

  const admin = createAdminClient();
  const { data: b } = await admin.from("businesses").select("id, name, city, domain, website_url, is_mock").eq("id", businessId).eq("org_id", orgId).maybeSingle();
  if (!b) return { error: "not_found" };
  const domain = (b.domain as string | null)?.toLowerCase() ?? null;
  const companyDomain = domain && !FREE_MAIL_DOMAINS.has(domain) ? domain : null;
  const hunter = getHunter();
  if (!b.website_url && !companyDomain && providerMode("openai") === "disabled") return { error: "no_sources" };

  await consumeCredits({ orgId, kind: "enrichment", userId, referenceType: "contacts", referenceId: businessId, idempotencyKey: `contacts:${businessId}:${new Date().toISOString().slice(0, 10)}` });

  const notes: string[] = [];
  const found = new Map<string, Candidate>();
  const add = (c: Omit<Candidate, "sources">, source: Source) => {
    const prev = found.get(c.email);
    if (prev) {
      if (!prev.sources.some((s) => s.provider === source.provider && s.url === source.url)) prev.sources.push(source);
      prev.firstName ??= c.firstName; prev.lastName ??= c.lastName; prev.fullName ??= c.fullName; prev.title ??= c.title;
      return;
    }
    found.set(c.email, { ...c, sources: [source] });
  };

  // 1. Website
  if (b.website_url) {
    const res = await crawl(b.website_url, { maxPages: 7, focus: "contact" });
    if (res.status === "ok") {
      for (const p of res.pages) {
        for (const email of p.emails) {
          if (acceptableForBusiness(email, domain, { publishedByBusiness: true })) add({ email, origin: "website" }, { provider: b.is_mock ? "mock" : "website_crawl", url: p.url });
        }
      }
    } else notes.push(res.status === "blocked" ? `website_${res.reason}` : "website_unreachable");
  }

  // 2. Hunter domain search
  if (hunter && companyDomain) {
    try {
      const result = await hunter.client.domainSearch(companyDomain, orgId, 10);
      for (const e of result?.emails ?? []) {
        const email = normalizeEmail(e.value);
        if (!email || !acceptableForBusiness(email, companyDomain, { publishedByBusiness: false })) continue;
        add(
          {
            email, origin: "hunter", firstName: e.first_name, lastName: e.last_name, fullName: [e.first_name, e.last_name].filter(Boolean).join(" ") || null,
            title: e.position, department: e.department, linkedin: e.linkedin ?? null, hunterType: e.type, verification: e.verification?.status ?? null, score: e.confidence,
          },
          { provider: hunter.isMock ? "mock" : "hunter", url: e.sources[0]?.uri ?? null, confidence: e.confidence, detail: { method: "domain_search", sources: e.sources.slice(0, 3).map((s) => s.uri) } },
        );
      }
    } catch (err) {
      if (err instanceof ProviderError && (err.status === 401 || err.status === 403)) notes.push("hunter_auth");
      else if (err instanceof ProviderError && err.status === 429) notes.push("hunter_limit");
      else notes.push("hunter_error");
    }
  }

  // 3. AI web search (+ deterministic verification)
  let people: { name: string; role: string; sourceUrl: string }[] = [];
  if (found.size < MIN_FOR_WEB_SEARCH) {
    const web = await webSearch({ name: b.name, city: b.city, website: b.website_url, domain }, orgId).catch(() => null);
    if (web) {
      const pages = new Map<string, string | null>();
      for (const url of sourceUrls(web.findings)) pages.set(url, await fetchPage(url));
      const verified = verifyFindings(web.findings, { name: b.name, domain }, pages);
      for (const v of verified.emails) {
        add({ email: v.email, origin: "web" }, { provider: web.isMock ? "mock" : "openai", url: v.sourceUrl, detail: { method: "web_search", quote: v.quote } });
      }
      people = verified.people;
      if (verified.rejected) notes.push(`web_rejected:${verified.rejected}`);
    }
  }

  // 4. Hunter Email Finder for named decision makers we have no address for yet
  if (hunter && companyDomain && people.length) {
    const known = new Set([...found.values()].map((c) => (c.fullName ?? "").toLowerCase()).filter(Boolean));
    for (const p of people.filter((x) => !known.has(x.name.toLowerCase())).slice(0, MAX_FINDER_LOOKUPS)) {
      try {
        const r = await hunter.client.emailFinder(companyDomain, p.name, orgId);
        const email = r?.email ? normalizeEmail(r.email) : null;
        if (!email || (r?.score ?? 0) < MIN_FINDER_SCORE || !acceptableForBusiness(email, companyDomain, { publishedByBusiness: false })) continue;
        const [first, ...rest] = p.name.split(" ");
        add(
          { email, origin: "finder", firstName: r?.first_name ?? first, lastName: r?.last_name ?? (rest.join(" ") || null), fullName: p.name, title: p.role, hunterType: "personal", verification: r?.verification?.status ?? null, score: r?.score ?? null },
          { provider: hunter.isMock ? "mock" : "hunter", url: p.sourceUrl, confidence: r?.score ?? null, detail: { method: "email_finder", person_source_url: p.sourceUrl } },
        );
      } catch (err) {
        if (err instanceof ProviderError && err.status === 429) {
          notes.push("hunter_limit");
          break;
        }
      }
    }
  }

  // 5. DNS: drop addresses whose domain cannot receive mail
  const mailDomains = new Map<string, boolean>();
  for (const c of found.values()) {
    const d = emailDomain(c.email);
    if (!mailDomains.has(d)) mailDomains.set(d, await acceptsMail(d));
    if (!mailDomains.get(d)) {
      found.delete(c.email);
      notes.push(`no_mx:${d}`);
    }
  }

  // Persist (existing contacts only get the new sources)
  const bySource: Record<ContactSourceKey, number> = { website: 0, hunter: 0, web: 0, finder: 0 };
  let added = 0;
  for (const c of found.values()) {
    const { data: existing } = await admin.from("contacts").select("id, business_id").eq("org_id", orgId).eq("email", c.email).maybeSingle();
    let contactId = existing?.id as string | undefined;
    if (existing && existing.business_id !== businessId) continue; // address already belongs to another company in this workspace
    if (!contactId) {
      const freeMail = FREE_MAIL_DOMAINS.has(emailDomain(c.email));
      const kind = c.hunterType ?? (classifyEmail(c.email) === "generic" ? "generic" : classifyEmail(c.email) === "personal" ? "personal" : "unknown");
      const { data: inserted, error } = await admin
        .from("contacts")
        .insert({
          org_id: orgId, business_id: businessId, email: c.email,
          first_name: c.firstName ?? null, last_name: c.lastName ?? null, full_name: c.fullName ?? null, job_title: c.title ?? null,
          department: c.department ?? null, linkedin_url: c.linkedin ?? null,
          email_type: kind === "generic" ? "generic" : kind === "personal" ? "personal" : "unknown",
          // Consumer mailboxes may belong to a natural person (sole trader): the compliance gate needs a documented basis.
          recipient_category: freeMail ? "unknown" : kind === "generic" ? "legal_entity_generic" : kind === "personal" ? "legal_entity_personal" : "unknown",
          email_verification: VERIFICATION_MAP[c.verification ?? "unknown"] ?? "unknown",
          email_verification_score: c.score ?? null,
          source: c.sources[0].provider, is_mock: Boolean(b.is_mock) || c.sources[0].provider === "mock",
        })
        .select("id")
        .single();
      if (error || !inserted) continue;
      contactId = inserted.id;
      added++;
      bySource[c.origin]++;
    }
    const { data: have } = await admin.from("contact_sources").select("provider, source_url").eq("contact_id", contactId!);
    const fresh = c.sources.filter((s) => !(have ?? []).some((h) => h.provider === s.provider && h.source_url === s.url));
    if (fresh.length) {
      await admin.from("contact_sources").insert(fresh.map((s) => ({ org_id: orgId, contact_id: contactId!, provider: s.provider, source_url: s.url, confidence: s.confidence ?? null, source_detail: s.detail ?? null })));
    }
  }

  // Emails written before an address was known get their recipient now.
  if (found.size) {
    const { data: all } = await admin.from("contacts").select("id, email, full_name, first_name, job_title, email_type, email_verification, is_primary").eq("business_id", businessId);
    const best = pickRecipient((all ?? []) as ContactCandidate[]);
    if (best?.email) {
      await admin.from("generated_emails").update({ recipient_email: best.email, contact_id: best.id }).eq("org_id", orgId).eq("business_id", businessId).is("recipient_email", null).eq("generation_status", "completed");
    }
  }
  await admin.from("activities").insert({ org_id: orgId, business_id: businessId, actor_id: userId, type: "contacts_found", data: { added, bySource, notes: notes.slice(0, 10) } });
  return { added, total: found.size, bySource, notes };
}

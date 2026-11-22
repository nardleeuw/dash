-- =============================================================================
-- Business intelligence (website analysis, opportunities, lead scores) and
-- the individual AI email generation engine.
-- =============================================================================

create table public.website_analyses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid not null,
  website_id uuid,
  url text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'blocked', 'no_website')),
  -- Pages actually fetched: [{ url, status, bytes, title }]
  pages jsonb not null default '[]'::jsonb,
  -- Deterministic signals detected from HTML/HTTP (ssl, viewport, booking, forms…)
  signals jsonb not null default '{}'::jsonb,
  -- PageSpeed / performance metrics when available
  performance jsonb,
  -- AI research output: services, target customers, observations (verified), hypotheses
  research jsonb,
  summary text,
  content_hash text,
  model text,
  prompt_version text,
  error text,
  is_mock boolean not null default false,
  requested_by uuid references public.users (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, website_id) references public.websites (org_id, id) on delete set null (website_id)
);
create index website_analyses_business_idx on public.website_analyses (business_id, created_at desc);
create index website_analyses_org_status_idx on public.website_analyses (org_id, status);
create trigger website_analyses_updated_at before update on public.website_analyses
  for each row execute function private.set_updated_at();

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid not null,
  analysis_id uuid,
  type text not null,
  title text not null,
  description text not null,
  -- [{ "kind": "observation"|"hypothesis", "text": "...", "source_url": "...", "quote": "..." }]
  evidence jsonb not null default '[]'::jsonb,
  -- true only when backed by a verified observation, false for hypotheses
  is_verified boolean not null default false,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  recommended_service text,
  status text not null default 'open' check (status in ('open', 'dismissed', 'used')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, analysis_id) references public.website_analyses (org_id, id) on delete cascade
);
create index opportunities_business_idx on public.opportunities (business_id);
create trigger opportunities_updated_at before update on public.opportunities
  for each row execute function private.set_updated_at();

create table public.lead_scores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid not null,
  total integer not null check (total between 0 and 100),
  -- [{ key, label, weight, score, reason, evidence: [] }]
  factors jsonb not null,
  weights jsonb not null,
  recommended_service text,
  analysis_id uuid,
  created_at timestamptz not null default now(),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, analysis_id) references public.website_analyses (org_id, id) on delete set null (analysis_id)
);
create index lead_scores_business_idx on public.lead_scores (business_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Agency (sender) profiles used to personalise emails. One default per
-- workspace (client_id is null) plus optional per-client profiles.
-- -----------------------------------------------------------------------------
create table public.agency_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid,
  agency_name text not null,
  website text,
  description text,
  -- [{ "name": "...", "description": "...", "ideal_for": "..." }]
  services jsonb not null default '[]'::jsonb,
  products text,
  target_industries text[] not null default '{}',
  ideal_customer_profile text,
  unique_selling_proposition text,
  tone_of_voice text,
  writing_style text,
  language text not null default 'nl' check (language in ('nl', 'en')),
  email_length text not null default 'short' check (email_length in ('short', 'medium', 'long')),
  call_to_action text,
  example_emails text[] not null default '{}',
  avoid_phrases text[] not null default '{}',
  sender_name text,
  sender_title text,
  signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, client_id) references public.agency_clients (org_id, id) on delete cascade
);
create unique index agency_profiles_default_uidx on public.agency_profiles (org_id) where client_id is null;
create unique index agency_profiles_client_uidx on public.agency_profiles (org_id, client_id) where client_id is not null;
create trigger agency_profiles_updated_at before update on public.agency_profiles
  for each row execute function private.set_updated_at();

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  kind text not null default 'follow_up' check (kind in ('initial', 'follow_up')),
  language text not null default 'nl' check (language in ('nl', 'en')),
  -- Guidance for the AI writer (never sent verbatim to recipients)
  instructions text,
  subject_template text,
  body_template text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create trigger email_templates_updated_at before update on public.email_templates
  for each row execute function private.set_updated_at();

create table public.follow_up_sequences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  -- [{ "step": 1, "delay_days": 3, "template_id": null, "instructions": "..." }]
  steps jsonb not null default '[]'::jsonb,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create trigger follow_up_sequences_updated_at before update on public.follow_up_sequences
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Generation batches and individually generated emails
-- -----------------------------------------------------------------------------
create table public.email_generation_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  agency_profile_id uuid not null,
  client_id uuid,
  name text,
  source text not null check (source in ('selection', 'list', 'filter', 'regenerate')),
  source_ref jsonb not null default '{}'::jsonb,
  mode text not null default 'missing_only' check (mode in ('missing_only', 'regenerate_all')),
  language text not null default 'nl' check (language in ('nl', 'en')),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'cancelled', 'failed')),
  total integer not null default 0,
  instructions text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, agency_profile_id) references public.agency_profiles (org_id, id),
  foreign key (org_id, client_id) references public.agency_clients (org_id, id) on delete set null (client_id)
);
create index email_generation_batches_org_idx on public.email_generation_batches (org_id, created_at desc);
create trigger email_generation_batches_updated_at before update on public.email_generation_batches
  for each row execute function private.set_updated_at();

create table public.generated_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  batch_id uuid,
  business_id uuid not null,
  contact_id uuid,
  agency_profile_id uuid not null,
  campaign_id uuid,
  sequence_step integer not null default 0 check (sequence_step >= 0),
  recipient_email extensions.citext,
  language text not null default 'nl' check (language in ('nl', 'en')),
  research_summary text,
  opportunity_id uuid,
  opportunity jsonb,
  -- [{ "claim": "...", "evidence": "...", "source": "website|kvk|..." }]
  personalization_evidence jsonb not null default '[]'::jsonb,
  personalization_score integer check (personalization_score between 0 and 100),
  -- { "passed": bool, "claims": [{ "claim": "", "supported": bool, "evidence": "" }] }
  fact_check jsonb,
  subject text,
  body text,
  alt_subject text,
  alt_body text,
  generation_status public.generation_status not null default 'queued',
  review_status public.review_status not null default 'pending',
  compliance_status public.compliance_status not null default 'unchecked',
  compliance_reasons jsonb not null default '[]'::jsonb,
  error text,
  attempts integer not null default 0,
  model text,
  prompt_version text,
  input_hash text,
  version integer not null default 1,
  is_mock boolean not null default false,
  edited_by uuid references public.users (id) on delete set null,
  edited_at timestamptz,
  approved_by uuid references public.users (id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, batch_id) references public.email_generation_batches (org_id, id) on delete set null (batch_id),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete set null (contact_id),
  foreign key (org_id, agency_profile_id) references public.agency_profiles (org_id, id),
  foreign key (org_id, opportunity_id) references public.opportunities (org_id, id) on delete set null (opportunity_id)
);
-- Never generate duplicate records accidentally: exactly one current email per
-- business × sender profile × sequence step (× campaign for follow-ups).
create unique index generated_emails_current_uidx on public.generated_emails
  (org_id, business_id, agency_profile_id, sequence_step, coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index generated_emails_batch_idx on public.generated_emails (batch_id, generation_status);
create index generated_emails_org_review_idx on public.generated_emails (org_id, review_status, created_at desc);
create trigger generated_emails_updated_at before update on public.generated_emails
  for each row execute function private.set_updated_at();
create trigger generated_emails_audit after update of review_status, compliance_status, subject, body on public.generated_emails
  for each row execute function private.audit_row_change();

-- Previous versions of a generated email (regeneration / manual edits).
create table public.generated_email_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  generated_email_id uuid not null,
  version integer not null,
  subject text,
  body text,
  reason text not null check (reason in ('regenerated', 'edited')),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, generated_email_id) references public.generated_emails (org_id, id) on delete cascade
);
create index generated_email_revisions_email_idx on public.generated_email_revisions (generated_email_id, version desc);

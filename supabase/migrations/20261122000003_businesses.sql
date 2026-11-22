-- =============================================================================
-- Unified business database with field-level provenance.
--
-- Entity model (never conflate these):
--   businesses          = a legal company (KVK registration / "onderneming")
--   business_locations  = an establishment ("vestiging") of that company
--   business_trade_names= trade names ("handelsnamen") of the company / location
--   websites            = a website (domain) linked to a company or location
--   contacts            = a person or mailbox at the company
-- =============================================================================

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Resolved ("golden record") values. Per-provider values live in business_attributes.
  name text not null check (char_length(name) between 1 and 300),
  legal_name text,
  kvk_number text check (kvk_number is null or kvk_number ~ '^[0-9]{8}$'),
  legal_form text,
  registration_status text not null default 'unknown' check (registration_status in ('active', 'inactive', 'unknown')),
  sbi_codes text[] not null default '{}',
  primary_sbi_code text,
  industry text,
  description text,
  website_url text,
  domain text,
  phone text,
  employee_range text,
  location_count integer,
  -- Denormalised from the main location for fast filtering.
  city text,
  municipality text,
  province text,
  postal_code text,
  lat double precision,
  lng double precision,
  -- CRM
  lead_status public.lead_status not null default 'new',
  lead_score integer check (lead_score between 0 and 100),
  score_updated_at timestamptz,
  assigned_to uuid references public.users (id) on delete set null,
  tags text[] not null default '{}',
  last_enriched_at timestamptz,
  last_researched_at timestamptz,
  is_mock boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create unique index businesses_org_kvk_uidx on public.businesses (org_id, kvk_number) where kvk_number is not null;
create index businesses_org_status_idx on public.businesses (org_id, lead_status);
create index businesses_org_score_idx on public.businesses (org_id, lead_score desc nulls last);
create index businesses_org_domain_idx on public.businesses (org_id, domain);
create index businesses_org_city_idx on public.businesses (org_id, city);
create index businesses_org_province_idx on public.businesses (org_id, province);
create index businesses_org_created_idx on public.businesses (org_id, created_at desc);
create index businesses_sbi_gin on public.businesses using gin (sbi_codes);
create index businesses_tags_gin on public.businesses using gin (tags);
create index businesses_name_trgm on public.businesses using gin (name extensions.gin_trgm_ops);
create trigger businesses_updated_at before update on public.businesses
  for each row execute function private.set_updated_at();

create table public.business_locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid not null,
  establishment_number text check (establishment_number is null or establishment_number ~ '^[0-9]{12}$'),
  is_main boolean not null default false,
  name text,
  street text,
  house_number text,
  house_number_addition text,
  postal_code text,
  city text,
  municipality text,
  province text,
  country text not null default 'NL',
  lat double precision,
  lng double precision,
  -- Source of the coordinates: Google coordinates may only be cached temporarily.
  geo_source public.data_provider,
  geo_expires_at timestamptz,
  phone text,
  website_url text,
  google_place_id text,
  osm_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade
);
create unique index business_locations_establishment_uidx on public.business_locations (org_id, establishment_number) where establishment_number is not null;
create unique index business_locations_place_uidx on public.business_locations (org_id, google_place_id) where google_place_id is not null;
create unique index business_locations_osm_uidx on public.business_locations (org_id, osm_id) where osm_id is not null;
create index business_locations_business_idx on public.business_locations (business_id);
create index business_locations_geo_idx on public.business_locations (org_id, lat, lng);
create index business_locations_postal_idx on public.business_locations (org_id, postal_code);
create trigger business_locations_updated_at before update on public.business_locations
  for each row execute function private.set_updated_at();

create table public.business_trade_names (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid not null,
  location_id uuid,
  name text not null,
  is_primary boolean not null default false,
  source public.data_provider not null,
  created_at timestamptz not null default now(),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, location_id) references public.business_locations (org_id, id) on delete cascade
);
create unique index business_trade_names_uidx on public.business_trade_names (business_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

create table public.websites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid not null,
  location_id uuid,
  url text not null,
  domain text not null,
  is_primary boolean not null default true,
  -- Was the link between this website and the company independently confirmed?
  verification_status public.verification_status not null default 'unverified',
  verification_evidence text,
  source public.data_provider not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (business_id, domain),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, location_id) references public.business_locations (org_id, id) on delete set null (location_id)
);
create index websites_org_domain_idx on public.websites (org_id, domain);
create trigger websites_updated_at before update on public.websites
  for each row execute function private.set_updated_at();

-- One row per retrieval from a provider. Holds retention metadata.
create table public.business_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid not null,
  location_id uuid,
  provider public.data_provider not null,
  external_id text,
  retrieved_at timestamptz not null default now(),
  -- Raw payload is only stored when the provider's terms permit storage.
  raw jsonb,
  retention_class text not null default 'standard'
    check (retention_class in ('standard', 'temporary', 'identifier_only', 'transient')),
  expires_at timestamptz,
  is_exportable boolean not null default false,
  attribution text,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, location_id) references public.business_locations (org_id, id) on delete cascade
);
create index business_sources_business_idx on public.business_sources (business_id);
create index business_sources_expiry_idx on public.business_sources (expires_at) where expires_at is not null;
create unique index business_sources_provider_uidx on public.business_sources
  (business_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, coalesce(external_id, ''));

-- Field-level provenance: each provider's value for each attribute.
create table public.business_attributes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid not null,
  location_id uuid,
  attribute text not null,
  value jsonb not null,
  source_id uuid,
  provider public.data_provider not null,
  retrieved_at timestamptz not null default now(),
  verification_status public.verification_status not null default 'unverified',
  confidence numeric(3, 2) check (confidence between 0 and 1),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, location_id) references public.business_locations (org_id, id) on delete cascade,
  foreign key (org_id, source_id) references public.business_sources (org_id, id) on delete set null (source_id)
);
create unique index business_attributes_uidx on public.business_attributes
  (business_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), attribute, provider);
create index business_attributes_expiry_idx on public.business_attributes (expires_at) where expires_at is not null;
create trigger business_attributes_updated_at before update on public.business_attributes
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Contacts
-- -----------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid not null,
  location_id uuid,
  first_name text,
  last_name text,
  full_name text,
  job_title text,
  department text,
  email extensions.citext,
  email_type public.email_address_type not null default 'unknown',
  recipient_category public.recipient_category not null default 'unknown',
  email_verification public.email_verification not null default 'unknown',
  email_verification_score integer,
  email_verified_at timestamptz,
  phone text,
  linkedin_url text,
  is_primary boolean not null default false,
  lead_status public.lead_status not null default 'new',
  source public.data_provider not null default 'manual',
  is_mock boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, location_id) references public.business_locations (org_id, id) on delete set null (location_id),
  check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
create unique index contacts_org_email_uidx on public.contacts (org_id, email) where email is not null;
create index contacts_business_idx on public.contacts (business_id);
create trigger contacts_updated_at before update on public.contacts
  for each row execute function private.set_updated_at();

create table public.contact_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  contact_id uuid not null,
  provider public.data_provider not null,
  source_url text,
  source_detail jsonb,
  confidence integer check (confidence between 0 and 100),
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete cascade
);
create index contact_sources_contact_idx on public.contact_sources (contact_id);

-- -----------------------------------------------------------------------------
-- Saved searches and lead lists
-- -----------------------------------------------------------------------------
create table public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  filters jsonb not null,
  last_run_at timestamptz,
  last_result_count integer,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create index saved_searches_org_idx on public.saved_searches (org_id);
create trigger saved_searches_updated_at before update on public.saved_searches
  for each row execute function private.set_updated_at();

create table public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, client_id) references public.agency_clients (org_id, id) on delete set null (client_id)
);
create index lead_lists_org_idx on public.lead_lists (org_id);
create trigger lead_lists_updated_at before update on public.lead_lists
  for each row execute function private.set_updated_at();

create table public.lead_list_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  list_id uuid not null,
  business_id uuid not null,
  contact_id uuid,
  added_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (list_id, business_id),
  foreign key (org_id, list_id) references public.lead_lists (org_id, id) on delete cascade,
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete set null (contact_id)
);
create index lead_list_members_business_idx on public.lead_list_members (business_id);

-- =============================================================================
-- Leadwerk — foundation: extensions, private helper schema, enums, utilities
-- =============================================================================

create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Helper functions that must never be exposed through the PostgREST API live
-- in the `private` schema (only `public` is exposed by Supabase by default).
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'admin', 'manager', 'sales_rep', 'viewer');

create type public.lead_status as enum (
  'new', 'enriched', 'qualified', 'approved', 'contacted', 'replied',
  'interested', 'meeting_booked', 'customer', 'not_interested', 'suppressed'
);

create type public.data_provider as enum (
  'kvk', 'google_places', 'osm', 'pdok', 'hunter', 'website_crawl', 'pagespeed',
  'openai', 'manual', 'import', 'mock'
);

create type public.verification_status as enum ('unverified', 'verified', 'conflicting', 'invalid');

create type public.email_verification as enum ('unknown', 'valid', 'invalid', 'accept_all', 'risky', 'disposable', 'webmail');

create type public.email_address_type as enum ('personal', 'role', 'generic', 'unknown');

create type public.recipient_category as enum (
  'natural_person',          -- private individual
  'sole_trader',             -- eenmanszaak / ZZP: legally a natural person
  'legal_entity_personal',   -- named employee address at a legal entity (jan@bedrijf.nl)
  'legal_entity_generic',    -- generic address at a legal entity (info@bedrijf.nl)
  'unknown'
);

create type public.permission_basis as enum (
  'consent',                   -- prior, specific, informed, documented consent
  'existing_customer',         -- existing customer relationship (soft opt-in) for own similar products
  'other_statutory_exception', -- any other exception — requires written justification
  'none'
);

create type public.suppression_reason as enum (
  'unsubscribe', 'objection', 'hard_bounce', 'complaint', 'manual', 'deletion_request', 'invalid_address'
);

create type public.generation_status as enum ('queued', 'researching', 'generating', 'completed', 'failed', 'skipped');
create type public.review_status as enum ('pending', 'approved', 'rejected');
create type public.compliance_status as enum ('unchecked', 'eligible', 'blocked');

create type public.campaign_status as enum ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled');
create type public.recipient_status as enum (
  'pending', 'active', 'completed', 'replied', 'bounced', 'unsubscribed', 'stopped', 'failed', 'cancelled'
);
create type public.message_status as enum ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'cancelled');

create type public.email_event_type as enum (
  'queued', 'sent', 'delivered', 'deferred', 'bounced_hard', 'bounced_soft',
  'complained', 'unsubscribed', 'replied', 'failed', 'cancelled'
);

create type public.reply_category as enum (
  'interested', 'meeting_request', 'more_info', 'not_interested', 'follow_up_later',
  'out_of_office', 'unsubscribe', 'complaint', 'unknown'
);

create type public.email_provider as enum ('smtp', 'gmail', 'microsoft', 'mock');

create type public.usage_kind as enum ('search', 'enrichment', 'research', 'email_generation', 'send');

-- -----------------------------------------------------------------------------
-- Utility functions
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.role_rank(r public.org_role)
returns int language sql immutable parallel safe as $$
  select case r
    when 'owner' then 50
    when 'admin' then 40
    when 'manager' then 30
    when 'sales_rep' then 20
    when 'viewer' then 10
  end;
$$;

-- Great-circle distance in kilometres.
create or replace function private.haversine_km(lat1 double precision, lng1 double precision,
                                                lat2 double precision, lng2 double precision)
returns double precision language sql immutable parallel safe as $$
  select 6371.0 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

grant execute on function private.role_rank(public.org_role) to authenticated, service_role;
grant execute on function private.haversine_km(double precision, double precision, double precision, double precision) to authenticated, service_role;

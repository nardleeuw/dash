-- =============================================================================
-- Multi-tenancy: users, organizations (agency workspaces), members, invitations,
-- agency clients, plans, subscriptions, usage, integrations, audit logs
-- =============================================================================

-- Mirror of auth.users with app-level profile data.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email extensions.citext not null,
  full_name text,
  locale text not null default 'nl' check (locale in ('nl', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated_at before update on public.users
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email, full_name, locale)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'nl')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function private.handle_new_auth_user();

-- Platform operators (the SaaS owner) — can edit plans and pricing.
create table public.platform_admins (
  user_id uuid primary key references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Plans (configurable pricing and limits)
-- -----------------------------------------------------------------------------
create table public.plans (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'eur',
  interval text not null default 'month' check (interval in ('month', 'year')),
  stripe_price_id text,
  -- { "users": 1, "search": 500, "enrichment": 200, "research": 200, "email_generation": 200, "send": 500 }
  limits jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  is_public boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_updated_at before update on public.plans
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Organizations = agency workspaces
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  country text not null default 'NL',
  locale text not null default 'nl' check (locale in ('nl', 'en')),
  -- Legal identity of the sender, required in outgoing commercial email.
  legal_name text,
  kvk_number text check (kvk_number is null or kvk_number ~ '^[0-9]{8}$'),
  postal_address text,
  privacy_policy_url text,
  -- Free-form settings: scoring weights, compliance rules, sending defaults.
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.org_role not null default 'viewer',
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);
create trigger organization_members_updated_at before update on public.organization_members
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Tenant helper functions (used by RLS policies).
-- They are SECURITY DEFINER so policies on organization_members don't recurse.
-- -----------------------------------------------------------------------------
create or replace function private.org_ids(p_min public.org_role default 'viewer')
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.org_id), '{}'::uuid[])
  from public.organization_members m
  where m.user_id = (select auth.uid())
    and private.role_rank(m.role) >= private.role_rank(p_min);
$$;

create or replace function private.has_org_role(p_org uuid, p_min public.org_role default 'viewer')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and private.role_rank(m.role) >= private.role_rank(p_min)
  );
$$;

create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

grant execute on function private.org_ids(public.org_role) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.org_role) to authenticated, service_role;
grant execute on function private.is_platform_admin() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Invitations
-- -----------------------------------------------------------------------------
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null,
  role public.org_role not null default 'sales_rep' check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid references public.users (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);
create index organization_invitations_org_idx on public.organization_invitations (org_id);

-- -----------------------------------------------------------------------------
-- Agency clients (an agency can run outreach on behalf of several clients)
-- -----------------------------------------------------------------------------
create table public.agency_clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  website text,
  description text,
  contact_email extensions.citext,
  is_archived boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create index agency_clients_org_idx on public.agency_clients (org_id);
create trigger agency_clients_updated_at before update on public.agency_clients
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Billing
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations (id) on delete cascade,
  plan_key text not null references public.plans (key),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_start timestamptz not null default date_trunc('month', now()),
  current_period_end timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  cancel_at_period_end boolean not null default false,
  trial_ends_at timestamptz,
  -- Optional per-organization overrides of plan limits (set by platform admins).
  limit_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();

-- Additional purchased credits; valid until expires_at (default: end of period).
create table public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind public.usage_kind not null,
  quantity integer not null check (quantity > 0),
  reason text not null default 'purchase',
  stripe_checkout_session_id text unique,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index credit_grants_org_idx on public.credit_grants (org_id, kind);

-- Every billable unit consumed by a workspace.
create table public.usage_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind public.usage_kind not null,
  quantity integer not null check (quantity > 0),
  -- Idempotency: the same unit of work is never billed twice.
  idempotency_key text not null,
  reference_type text,
  reference_id uuid,
  user_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
create index usage_records_org_period_idx on public.usage_records (org_id, kind, created_at desc);

-- Actual third-party provider cost and latency tracking.
create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  provider public.data_provider not null,
  operation text not null,
  units integer not null default 1,
  input_tokens integer,
  output_tokens integer,
  cost_micros bigint not null default 0, -- estimated cost in millionths of a euro
  status text not null default 'ok' check (status in ('ok', 'error', 'rate_limited', 'mock')),
  latency_ms integer,
  error text,
  created_at timestamptz not null default now()
);
create index api_usage_org_idx on public.api_usage (org_id, created_at desc);
create index api_usage_provider_idx on public.api_usage (provider, created_at desc);

-- Processed webhook ids (Stripe, email providers) for idempotent handling.
create table public.webhook_events (
  id text not null,
  provider text not null,
  type text,
  processed_at timestamptz not null default now(),
  primary key (provider, id)
);

-- -----------------------------------------------------------------------------
-- Integrations (per workspace configuration; secrets kept separately)
-- -----------------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  config jsonb not null default '{}'::jsonb,
  last_error text,
  connected_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider)
);
create trigger integrations_updated_at before update on public.integrations
  for each row execute function private.set_updated_at();

-- Encrypted secrets — never readable from the browser (no RLS policies, no grants).
create table public.integration_secrets (
  integration_id uuid primary key references public.integrations (id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Audit log (append-only)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete cascade,
  actor_user_id uuid references public.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (org_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- Generic row-level audit trigger for compliance-relevant tables.
create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_changed jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_changed
    from jsonb_each(v_row)
    where key not in ('updated_at', 'body', 'alt_body', 'ciphertext')
      and v_old -> key is distinct from value;
    if v_changed = '{}'::jsonb then
      return new;
    end if;
  end if;

  insert into public.audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    (v_row ->> 'org_id')::uuid,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', v_changed) else '{}'::jsonb end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger organization_members_audit after insert or update or delete on public.organization_members
  for each row execute function private.audit_row_change();
create trigger subscriptions_audit after insert or update on public.subscriptions
  for each row execute function private.audit_row_change();

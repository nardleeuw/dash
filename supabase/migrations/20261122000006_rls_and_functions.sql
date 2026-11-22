-- =============================================================================
-- Row Level Security, privilege hardening and RPC functions.
--
-- Principles:
--   * Every tenant table has RLS enabled; access is scoped to org membership.
--   * Roles: owner > admin > manager > sales_rep > viewer.
--   * System-managed columns (compliance, delivery state) are writable only by
--     the service role (background jobs), never directly by browser clients.
--   * Secrets tables have RLS enabled and NO policies -> service role only.
-- =============================================================================

-- The anon role never reads application tables directly.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Execution of private helpers by the API roles is limited to RLS evaluation.
revoke all on all functions in schema private from public;
grant execute on function private.role_rank(public.org_role) to authenticated, service_role;
grant execute on function private.org_ids(public.org_role) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.org_role) to authenticated, service_role;
grant execute on function private.is_platform_admin() to authenticated, service_role;
grant execute on function private.haversine_km(double precision, double precision, double precision, double precision) to authenticated, service_role;

-- Helper that creates the standard four tenant policies on a table.
create or replace function private.apply_tenant_policies(
  p_table regclass,
  p_insert public.org_role,  -- null = no insert policy
  p_update public.org_role,  -- null = no update policy
  p_delete public.org_role   -- null = no delete policy
) returns void language plpgsql as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force row level security', p_table);
  execute format(
    'create policy tenant_select on %s for select to authenticated using (org_id = any ((select private.org_ids(''viewer''))::uuid[]))',
    p_table);
  if p_insert is not null then
    execute format(
      'create policy tenant_insert on %s for insert to authenticated with check (org_id = any ((select private.org_ids(%L))::uuid[]))',
      p_table, p_insert);
  end if;
  if p_update is not null then
    execute format(
      'create policy tenant_update on %s for update to authenticated using (org_id = any ((select private.org_ids(%L))::uuid[])) with check (org_id = any ((select private.org_ids(%L))::uuid[]))',
      p_table, p_update, p_update);
  end if;
  if p_delete is not null then
    execute format(
      'create policy tenant_delete on %s for delete to authenticated using (org_id = any ((select private.org_ids(%L))::uuid[]))',
      p_table, p_delete);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Users / platform
-- -----------------------------------------------------------------------------
alter table public.users enable row level security;
create policy users_select on public.users for select to authenticated using (
  id = (select auth.uid())
  or exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = public.users.id
  )
);
create policy users_update_self on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table public.platform_admins enable row level security;
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

alter table public.plans enable row level security;
create policy plans_select on public.plans for select to authenticated
  using (is_active or (select private.is_platform_admin()));
create policy plans_admin_write on public.plans for all to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- Organizations & membership
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
create policy organizations_select on public.organizations for select to authenticated
  using (id = any ((select private.org_ids('viewer'))::uuid[]));
create policy organizations_update on public.organizations for update to authenticated
  using (id = any ((select private.org_ids('admin'))::uuid[]))
  with check (id = any ((select private.org_ids('admin'))::uuid[]));
-- Inserts happen through create_organization(); deletes are owner-only.
create policy organizations_delete on public.organizations for delete to authenticated
  using (id = any ((select private.org_ids('owner'))::uuid[]));

alter table public.organization_members enable row level security;
create policy organization_members_select on public.organization_members for select to authenticated
  using (org_id = any ((select private.org_ids('viewer'))::uuid[]));
-- Writes go through set_member_role(), remove_member(), accept_invitation().

select private.apply_tenant_policies('public.organization_invitations', 'admin', 'admin', 'admin');
-- Invitations are visible to admins only (they contain addresses of non-members).
drop policy tenant_select on public.organization_invitations;
create policy tenant_select on public.organization_invitations for select to authenticated
  using (org_id = any ((select private.org_ids('admin'))::uuid[]));

select private.apply_tenant_policies('public.agency_clients', 'manager', 'manager', 'admin');

-- -----------------------------------------------------------------------------
-- Billing & usage: read-only for members, written by the service role.
-- -----------------------------------------------------------------------------
select private.apply_tenant_policies('public.subscriptions', null, null, null);
select private.apply_tenant_policies('public.credit_grants', null, null, null);
select private.apply_tenant_policies('public.usage_records', null, null, null);

alter table public.api_usage enable row level security;
create policy api_usage_select on public.api_usage for select to authenticated
  using (org_id = any ((select private.org_ids('admin'))::uuid[]));

alter table public.webhook_events enable row level security; -- service role only

select private.apply_tenant_policies('public.integrations', 'admin', 'admin', 'admin');
alter table public.integration_secrets enable row level security; -- service role only
revoke all on public.integration_secrets from authenticated;

alter table public.audit_logs enable row level security;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (org_id = any ((select private.org_ids('admin'))::uuid[]));

-- -----------------------------------------------------------------------------
-- Business data
-- -----------------------------------------------------------------------------
select private.apply_tenant_policies('public.businesses', 'sales_rep', 'sales_rep', 'manager');
select private.apply_tenant_policies('public.business_locations', 'sales_rep', 'sales_rep', 'manager');
select private.apply_tenant_policies('public.business_trade_names', 'sales_rep', 'sales_rep', 'manager');
select private.apply_tenant_policies('public.websites', 'sales_rep', 'sales_rep', 'manager');
select private.apply_tenant_policies('public.business_sources', null, null, 'manager');
select private.apply_tenant_policies('public.business_attributes', null, null, 'manager');
select private.apply_tenant_policies('public.contacts', 'sales_rep', 'sales_rep', 'manager');
select private.apply_tenant_policies('public.contact_sources', 'sales_rep', null, 'manager');
select private.apply_tenant_policies('public.saved_searches', 'sales_rep', 'sales_rep', 'sales_rep');
select private.apply_tenant_policies('public.lead_lists', 'sales_rep', 'sales_rep', 'manager');
select private.apply_tenant_policies('public.lead_list_members', 'sales_rep', null, 'sales_rep');

-- -----------------------------------------------------------------------------
-- Intelligence & generation (created by background jobs)
-- -----------------------------------------------------------------------------
select private.apply_tenant_policies('public.website_analyses', null, null, 'manager');
select private.apply_tenant_policies('public.opportunities', null, 'sales_rep', 'manager');
select private.apply_tenant_policies('public.lead_scores', null, null, 'manager');
select private.apply_tenant_policies('public.agency_profiles', 'manager', 'manager', 'admin');
select private.apply_tenant_policies('public.email_templates', 'manager', 'manager', 'manager');
select private.apply_tenant_policies('public.follow_up_sequences', 'manager', 'manager', 'manager');
select private.apply_tenant_policies('public.email_generation_batches', null, null, 'manager');
select private.apply_tenant_policies('public.generated_emails', null, 'sales_rep', 'manager');
select private.apply_tenant_policies('public.generated_email_revisions', null, null, null);

-- -----------------------------------------------------------------------------
-- Compliance
-- -----------------------------------------------------------------------------
select private.apply_tenant_policies('public.email_permissions', 'manager', 'manager', 'admin');
-- Anyone who can work leads may suppress an address; only admins may lift it.
select private.apply_tenant_policies('public.suppression_records', 'sales_rep', null, 'admin');
select private.apply_tenant_policies('public.data_subject_requests', 'manager', 'manager', 'admin');
select private.apply_tenant_policies('public.privacy_notices', 'admin', 'admin', 'admin');

-- -----------------------------------------------------------------------------
-- Sending, campaigns, inbox, CRM
-- -----------------------------------------------------------------------------
select private.apply_tenant_policies('public.email_accounts', null, 'admin', 'admin');
alter table public.email_account_secrets enable row level security; -- service role only
revoke all on public.email_account_secrets from authenticated;
select private.apply_tenant_policies('public.email_account_sync_state', null, null, null);

select private.apply_tenant_policies('public.campaigns', 'sales_rep', 'sales_rep', 'manager');
select private.apply_tenant_policies('public.campaign_recipients', null, null, null);
select private.apply_tenant_policies('public.outbound_messages', null, null, null);
select private.apply_tenant_policies('public.email_events', null, null, null);
select private.apply_tenant_policies('public.conversations', null, 'sales_rep', null);
select private.apply_tenant_policies('public.replies', null, null, null);
select private.apply_tenant_policies('public.tasks', 'sales_rep', 'sales_rep', 'sales_rep');
select private.apply_tenant_policies('public.notes', 'sales_rep', 'sales_rep', 'sales_rep');
select private.apply_tenant_policies('public.activities', 'sales_rep', null, null);

-- -----------------------------------------------------------------------------
-- Guards for system-managed columns
-- -----------------------------------------------------------------------------
create or replace function private.is_end_user_request()
returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') in ('authenticated', 'anon');
$$;

create or replace function private.guard_generated_emails()
returns trigger language plpgsql as $$
begin
  if private.is_end_user_request() then
    if new.compliance_status is distinct from old.compliance_status
       or new.compliance_reasons is distinct from old.compliance_reasons
       or new.generation_status is distinct from old.generation_status
       or new.fact_check is distinct from old.fact_check
       or new.personalization_score is distinct from old.personalization_score
       or new.is_mock is distinct from old.is_mock
       or new.org_id is distinct from old.org_id
       or new.business_id is distinct from old.business_id
       or new.campaign_id is distinct from old.campaign_id then
      raise exception 'system-managed column cannot be changed directly' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger generated_emails_guard before update on public.generated_emails
  for each row execute function private.guard_generated_emails();

create or replace function private.guard_campaigns()
returns trigger language plpgsql as $$
begin
  if private.is_end_user_request() then
    if tg_op = 'INSERT' and new.status <> 'draft' then
      raise exception 'campaigns are created as drafts' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.status is distinct from old.status
        or new.launched_at is distinct from old.launched_at
        or new.org_id is distinct from old.org_id) then
      raise exception 'campaign status is changed through the campaign controls' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger campaigns_guard before insert or update on public.campaigns
  for each row execute function private.guard_campaigns();

create or replace function private.guard_business_system_columns()
returns trigger language plpgsql as $$
begin
  if private.is_end_user_request() then
    if tg_op = 'INSERT' and new.is_mock then
      raise exception 'mock records are created by the system only' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.is_mock is distinct from old.is_mock or new.org_id is distinct from old.org_id) then
      raise exception 'system-managed column cannot be changed directly' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger businesses_guard before insert or update on public.businesses
  for each row execute function private.guard_business_system_columns();

-- -----------------------------------------------------------------------------
-- RPC: organizations & membership
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_org uuid;
  v_slug text := lower(p_slug);
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(trim(p_name)) = 0 then
    raise exception 'name required' using errcode = '22023';
  end if;
  -- Ensure the slug is unique by appending a short suffix if needed.
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := left(v_slug, 56) || '-' || substr(md5(random()::text), 1, 6);
  end if;

  insert into public.organizations (name, slug, created_by)
  values (trim(p_name), v_slug, v_user)
  returning id into v_org;

  insert into public.organization_members (org_id, user_id, role)
  values (v_org, v_user, 'owner');

  insert into public.subscriptions (org_id, plan_key, status, trial_ends_at)
  values (v_org, 'trial', 'trialing', now() + interval '14 days');

  insert into public.agency_profiles (org_id, agency_name)
  values (v_org, trim(p_name));

  return v_org;
end;
$$;
grant execute on function public.create_organization(text, text) to authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_inv public.organization_invitations;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select email into v_email from public.users where id = v_user;

  select * into v_inv from public.organization_invitations
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if v_inv.id is null or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'invitation invalid or expired' using errcode = '22023';
  end if;
  if lower(v_inv.email::text) <> lower(v_email) then
    raise exception 'invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.organization_members (org_id, user_id, role, invited_by)
  values (v_inv.org_id, v_user, v_inv.role, v_inv.invited_by)
  on conflict (org_id, user_id) do nothing;

  update public.organization_invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.org_id;
end;
$$;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.set_member_role(p_member_id uuid, p_role public.org_role)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_member public.organization_members;
  v_owner_count int;
begin
  select * into v_member from public.organization_members where id = p_member_id for update;
  if v_member.id is null or not private.has_org_role(v_member.org_id, 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Only owners may grant or revoke ownership.
  if (p_role = 'owner' or v_member.role = 'owner') and not private.has_org_role(v_member.org_id, 'owner') then
    raise exception 'only owners can change ownership' using errcode = '42501';
  end if;
  if v_member.role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count from public.organization_members
    where org_id = v_member.org_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'a workspace needs at least one owner' using errcode = '22023';
    end if;
  end if;
  update public.organization_members set role = p_role where id = p_member_id;
end;
$$;
grant execute on function public.set_member_role(uuid, public.org_role) to authenticated;

create or replace function public.remove_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_member public.organization_members;
  v_owner_count int;
begin
  select * into v_member from public.organization_members where id = p_member_id for update;
  if v_member.id is null then
    raise exception 'not found' using errcode = '22023';
  end if;
  -- Members may leave; admins may remove others (owners only by owners).
  if v_member.user_id <> (select auth.uid()) then
    if not private.has_org_role(v_member.org_id, 'admin') then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_member.role = 'owner' and not private.has_org_role(v_member.org_id, 'owner') then
      raise exception 'only owners can remove owners' using errcode = '42501';
    end if;
  end if;
  if v_member.role = 'owner' then
    select count(*) into v_owner_count from public.organization_members
    where org_id = v_member.org_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'a workspace needs at least one owner' using errcode = '22023';
    end if;
  end if;
  delete from public.organization_members where id = p_member_id;
end;
$$;
grant execute on function public.remove_member(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: credits & usage
-- -----------------------------------------------------------------------------
create or replace function public.credit_status(p_org uuid)
returns table (kind public.usage_kind, used bigint, allowance bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sub public.subscriptions;
  v_limits jsonb;
begin
  if not (private.has_org_role(p_org, 'viewer') or coalesce(current_setting('request.jwt.claims', true), '') = ''
          or (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where org_id = p_org;
  select p.limits || coalesce(v_sub.limit_overrides, '{}'::jsonb) into v_limits
  from public.plans p where p.key = v_sub.plan_key;

  return query
  select k.kind,
    coalesce((select sum(u.quantity) from public.usage_records u
              where u.org_id = p_org and u.kind = k.kind
                and u.created_at >= v_sub.current_period_start and u.created_at < v_sub.current_period_end), 0)::bigint,
    (coalesce((v_limits ->> k.kind::text)::bigint, 0)
     + coalesce((select sum(g.quantity) from public.credit_grants g
                 where g.org_id = p_org and g.kind = k.kind
                   and g.created_at >= v_sub.current_period_start
                   and (g.expires_at is null or g.expires_at > now())), 0))::bigint
  from unnest(enum_range(null::public.usage_kind)) as k(kind);
end;
$$;
grant execute on function public.credit_status(uuid) to authenticated, service_role;

-- Atomically check the allowance and record usage. Returns false when the
-- allowance would be exceeded. Idempotent per (org, idempotency key).
create or replace function public.consume_credits(
  p_org uuid, p_kind public.usage_kind, p_quantity int, p_idempotency_key text,
  p_reference_type text default null, p_reference_id uuid default null, p_user uuid default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_used bigint;
  v_allowance bigint;
  v_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_kind::text, 0));

  if exists (select 1 from public.usage_records where org_id = p_org and idempotency_key = p_idempotency_key) then
    return true;
  end if;

  select s.status into v_status from public.subscriptions s where s.org_id = p_org;
  if v_status is null or v_status not in ('trialing', 'active') then
    return false;
  end if;

  select c.used, c.allowance into v_used, v_allowance
  from public.credit_status(p_org) c where c.kind = p_kind;

  if v_used + p_quantity > v_allowance then
    return false;
  end if;

  insert into public.usage_records (org_id, kind, quantity, idempotency_key, reference_type, reference_id, user_id)
  values (p_org, p_kind, p_quantity, p_idempotency_key, p_reference_type, p_reference_id, p_user);
  return true;
end;
$$;
revoke execute on function public.consume_credits(uuid, public.usage_kind, int, text, text, uuid, uuid) from public, authenticated;
grant execute on function public.consume_credits(uuid, public.usage_kind, int, text, text, uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- RPC: compliance helpers
-- -----------------------------------------------------------------------------
create or replace function public.is_suppressed(p_org uuid, p_email text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.suppression_records s
    where s.org_id = p_org
      and (s.email = p_email::extensions.citext
           or (s.email is null and s.domain = split_part(p_email, '@', 2)::extensions.citext))
  );
$$;
grant execute on function public.is_suppressed(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RPC: geo filtering on the lead database (RLS applies: security invoker)
-- -----------------------------------------------------------------------------
create or replace function public.business_ids_within_radius(p_org uuid, p_lat double precision, p_lng double precision, p_km double precision)
returns setof uuid language sql stable security invoker set search_path = '' as $$
  select distinct l.business_id
  from public.business_locations l
  where l.org_id = p_org
    and l.lat between p_lat - (p_km / 111.0) and p_lat + (p_km / 111.0)
    and l.lng between p_lng - (p_km / (111.0 * cos(radians(p_lat)))) and p_lng + (p_km / (111.0 * cos(radians(p_lat))))
    and private.haversine_km(p_lat, p_lng, l.lat, l.lng) <= p_km;
$$;
grant execute on function public.business_ids_within_radius(uuid, double precision, double precision, double precision) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Sending worker: claim due recipients without double-processing.
-- -----------------------------------------------------------------------------
alter table public.campaign_recipients add column locked_until timestamptz;

create or replace function public.claim_due_recipients(p_limit int default 50)
returns setof public.campaign_recipients
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select r.id from public.campaign_recipients r
    join public.campaigns c on c.id = r.campaign_id
    where r.status = 'active'
      and r.next_send_at <= now()
      and (r.locked_until is null or r.locked_until < now())
      and c.status = 'running'
    order by r.next_send_at
    limit p_limit
    for update of r skip locked
  )
  update public.campaign_recipients r
  set locked_until = now() + interval '10 minutes'
  from due where r.id = due.id
  returning r.*;
end;
$$;
revoke execute on function public.claim_due_recipients(int) from public, authenticated;
grant execute on function public.claim_due_recipients(int) to service_role;

-- -----------------------------------------------------------------------------
-- Storage: private bucket for compliance evidence, scoped by org folder.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('compliance-evidence', 'compliance-evidence', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'message/rfc822'])
on conflict (id) do nothing;

create policy compliance_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'compliance-evidence'
         and (storage.foldername(name))[1] in (select unnest((select private.org_ids('manager')))::text));
create policy compliance_evidence_write on storage.objects for insert to authenticated
  with check (bucket_id = 'compliance-evidence'
              and (storage.foldername(name))[1] in (select unnest((select private.org_ids('manager')))::text));

-- -----------------------------------------------------------------------------
-- Default plans (prices configurable by platform admins in the app)
-- -----------------------------------------------------------------------------
insert into public.plans (key, name, description, price_cents, limits, sort_order, is_public) values
  ('trial', 'Proefperiode', '14 dagen gratis proberen', 0,
   '{"users": 2, "search": 200, "enrichment": 50, "research": 25, "email_generation": 25, "send": 0}', 0, false),
  ('starter', 'Starter', 'Voor freelancers en kleine agencies', 4900,
   '{"users": 1, "search": 1000, "enrichment": 250, "research": 150, "email_generation": 150, "send": 500}', 1, true),
  ('growth', 'Growth', 'Voor groeiende agencies', 9900,
   '{"users": 3, "search": 3000, "enrichment": 750, "research": 500, "email_generation": 500, "send": 2000}', 2, true),
  ('pro', 'Pro', 'Voor teams met meerdere klanten', 19900,
   '{"users": 10, "search": 10000, "enrichment": 2500, "research": 1500, "email_generation": 1500, "send": 6000}', 3, true)
on conflict (key) do nothing;

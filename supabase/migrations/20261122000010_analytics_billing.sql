-- =============================================================================
-- Analytics RPC, trial expiry in credit checks, seat limits.
-- Opens are deliberately not tracked: they are not a reliable success metric.
-- =============================================================================

create or replace function public.analytics_summary(p_org uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not private.has_org_role(p_org, 'viewer') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with
  biz as (select * from public.businesses where org_id = p_org),
  gen as (select * from public.generated_emails where org_id = p_org and created_at >= p_from and created_at < p_to),
  out as (select * from public.outbound_messages where org_id = p_org and sent_at >= p_from and sent_at < p_to and campaign_recipient_id is not null),
  rep as (select r.*, o.business_id as o_business, o.campaign_id as o_campaign from public.replies r left join public.outbound_messages o on o.id = r.outbound_message_id
          where r.org_id = p_org and r.received_at >= p_from and r.received_at < p_to and not r.is_auto_reply),
  ev as (select * from public.email_events where org_id = p_org and occurred_at >= p_from and occurred_at < p_to)
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'discovered', (select count(*) from biz where created_at >= p_from and created_at < p_to),
      'enriched', (select count(*) from biz where coalesce(last_researched_at, last_enriched_at) >= p_from and coalesce(last_researched_at, last_enriched_at) < p_to),
      'qualified', (select count(*) from biz where lead_score >= 60 and score_updated_at >= p_from and score_updated_at < p_to),
      'generated', (select count(*) from gen where generation_status = 'completed'),
      'approved', (select count(*) from gen where review_status = 'approved'),
      'sent', (select count(*) from out where status in ('sent', 'delivered', 'bounced')),
      'delivered', (select count(*) from out where status in ('sent', 'delivered')),
      'bounced', (select count(*) from ev where type in ('bounced_hard', 'bounced_soft')),
      'unsubscribed', (select count(*) from ev where type = 'unsubscribed'),
      'replies', (select count(*) from rep),
      'positive', (select count(*) from rep where ai_category in ('interested', 'meeting_request')),
      'meetings', (select count(*) from biz where lead_status = 'meeting_booked' and updated_at >= p_from and updated_at < p_to),
      'customers', (select count(*) from biz where lead_status = 'customer' and updated_at >= p_from and updated_at < p_to)
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'sent', s, 'replies', r, 'positive', p) order by d)
      from (
        select gs as d,
          (select count(*) from out where sent_at::date = gs::date) as s,
          (select count(*) from rep where received_at::date = gs::date) as r,
          (select count(*) from rep where received_at::date = gs::date and ai_category in ('interested', 'meeting_request')) as p
        from generate_series(date_trunc('day', p_from), date_trunc('day', p_to - interval '1 second'), interval '1 day') gs
      ) x
    ), '[]'::jsonb),
    'by_industry', coalesce((
      select jsonb_agg(row_to_json(t) order by t.sent desc) from (
        select coalesce(b.industry, 'unknown') as key, count(distinct o.id) as sent,
          count(distinct r.id) as replies, count(distinct r.id) filter (where r.ai_category in ('interested', 'meeting_request')) as positive
        from out o join biz b on b.id = o.business_id left join rep r on r.outbound_message_id = o.id
        group by 1 limit 30) t
    ), '[]'::jsonb),
    'by_province', coalesce((
      select jsonb_agg(row_to_json(t) order by t.sent desc) from (
        select coalesce(b.province, 'unknown') as key, count(distinct o.id) as sent,
          count(distinct r.id) as replies, count(distinct r.id) filter (where r.ai_category in ('interested', 'meeting_request')) as positive
        from out o join biz b on b.id = o.business_id left join rep r on r.outbound_message_id = o.id
        group by 1 limit 20) t
    ), '[]'::jsonb),
    'by_campaign', coalesce((
      select jsonb_agg(row_to_json(t) order by t.sent desc) from (
        select c.id, c.name as key, count(distinct o.id) as sent, count(distinct r.id) as replies,
          count(distinct r.id) filter (where r.ai_category in ('interested', 'meeting_request')) as positive,
          count(distinct e.id) filter (where e.type in ('bounced_hard', 'bounced_soft')) as bounced
        from public.campaigns c
        left join out o on o.campaign_id = c.id
        left join rep r on r.outbound_message_id = o.id
        left join ev e on e.outbound_message_id = o.id
        where c.org_id = p_org
        group by c.id, c.name limit 50) t
    ), '[]'::jsonb),
    'by_client', coalesce((
      select jsonb_agg(row_to_json(t) order by t.sent desc) from (
        select coalesce(ac.name, '—') as key, count(distinct o.id) as sent, count(distinct r.id) as replies,
          count(distinct r.id) filter (where r.ai_category in ('interested', 'meeting_request')) as positive
        from out o join public.campaigns c on c.id = o.campaign_id left join public.agency_clients ac on ac.id = c.client_id
        left join rep r on r.outbound_message_id = o.id
        group by 1 limit 50) t
    ), '[]'::jsonb),
    'by_version', coalesce((
      select jsonb_agg(row_to_json(t) order by t.sent desc) from (
        select coalesce(g.prompt_version, 'manual') || case when g.edited_at is not null then ' (edited)' else '' end as key,
          count(distinct o.id) as sent, count(distinct r.id) as replies,
          count(distinct r.id) filter (where r.ai_category in ('interested', 'meeting_request')) as positive
        from out o join public.generated_emails g on g.id = o.generated_email_id left join rep r on r.outbound_message_id = o.id
        group by 1 limit 20) t
    ), '[]'::jsonb),
    'reply_categories', coalesce((select jsonb_object_agg(coalesce(ai_category::text, 'unknown'), n) from (select ai_category, count(*) n from rep group by 1) x), '{}'::jsonb)
  ) into v;
  return v;
end;
$$;
grant execute on function public.analytics_summary(uuid, timestamptz, timestamptz) to authenticated;

-- Provider cost overview for admins.
create or replace function public.provider_costs(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (provider public.data_provider, calls bigint, errors bigint, cost_micros bigint, input_tokens bigint, output_tokens bigint)
language sql stable security definer set search_path = '' as $$
  select a.provider, count(*), count(*) filter (where a.status <> 'ok'), coalesce(sum(a.cost_micros), 0)::bigint,
    coalesce(sum(a.input_tokens), 0)::bigint, coalesce(sum(a.output_tokens), 0)::bigint
  from public.api_usage a
  where a.org_id = p_org and a.created_at >= p_from and a.created_at < p_to and private.has_org_role(p_org, 'admin')
  group by a.provider;
$$;
grant execute on function public.provider_costs(uuid, timestamptz, timestamptz) to authenticated;

-- Trial expiry: an expired trial no longer consumes credits.
create or replace function public.consume_credits(
  p_org uuid, p_kind public.usage_kind, p_quantity int, p_idempotency_key text,
  p_reference_type text default null, p_reference_id uuid default null, p_user uuid default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_used bigint;
  v_allowance bigint;
  v_sub public.subscriptions;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_kind::text, 0));
  if exists (select 1 from public.usage_records where org_id = p_org and idempotency_key = p_idempotency_key) then
    return true;
  end if;
  select * into v_sub from public.subscriptions s where s.org_id = p_org;
  if v_sub.id is null or v_sub.status not in ('trialing', 'active') then
    return false;
  end if;
  if v_sub.status = 'trialing' and v_sub.trial_ends_at is not null and v_sub.trial_ends_at < now() then
    return false;
  end if;
  select c.used, c.allowance into v_used, v_allowance from public.credit_status(p_org) c where c.kind = p_kind;
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

-- Seats: members + open invitations may not exceed the plan's user limit.
create or replace function public.seat_status(p_org uuid)
returns table (used bigint, allowed bigint) language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from public.organization_members m where m.org_id = p_org)
      + (select count(*) from public.organization_invitations i where i.org_id = p_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
    coalesce(((p.limits || s.limit_overrides) ->> 'users')::bigint, 1)
  from public.subscriptions s join public.plans p on p.key = s.plan_key
  where s.org_id = p_org and private.has_org_role(p_org, 'viewer');
$$;
grant execute on function public.seat_status(uuid) to authenticated, service_role;

create or replace function private.enforce_seat_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_used bigint;
  v_allowed bigint;
begin
  select
    (select count(*) from public.organization_members m where m.org_id = new.org_id)
      + (select count(*) from public.organization_invitations i where i.org_id = new.org_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()),
    coalesce(((p.limits || s.limit_overrides) ->> 'users')::bigint, 1)
  into v_used, v_allowed
  from public.subscriptions s join public.plans p on p.key = s.plan_key where s.org_id = new.org_id;
  if v_used + 1 > v_allowed then
    raise exception 'seat limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger organization_invitations_seat_limit before insert on public.organization_invitations
  for each row execute function private.enforce_seat_limit();

-- Purchasable credit packs (configurable by platform admins).
create table public.credit_packs (
  key text primary key,
  kind public.usage_kind not null,
  quantity integer not null check (quantity > 0),
  price_cents integer not null check (price_cents >= 0),
  stripe_price_id text,
  is_active boolean not null default true
);
alter table public.credit_packs enable row level security;
create policy credit_packs_select on public.credit_packs for select to authenticated using (is_active or (select private.is_platform_admin()));
create policy credit_packs_admin on public.credit_packs for all to authenticated using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
insert into public.credit_packs (key, kind, quantity, price_cents) values
  ('emails_250', 'email_generation', 250, 2500),
  ('research_250', 'research', 250, 2000),
  ('enrichment_500', 'enrichment', 500, 2000),
  ('sends_1000', 'send', 1000, 1500)
on conflict (key) do nothing;

-- Usage-based billing: one-time start fee (price_cents of the 'usage' plan),
-- then monthly invoices for actual provider costs plus the operator's markup.
insert into public.plans (key, name, description, price_cents, limits, sort_order, is_public) values
  ('usage', 'Op verbruik', 'Eenmalig starttarief, daarna maandelijks alleen wat je gebruikt', 50000,
   '{"users": 10, "search": 1000000, "enrichment": 1000000, "research": 1000000, "email_generation": 1000000, "send": 1000000}', 0, true)
on conflict (key) do nothing;

-- The fixed packages stay for existing workspaces but are no longer offered.
update public.plans set is_public = false where key in ('starter', 'growth', 'pro');

alter table public.subscriptions
  add column if not exists setup_paid_at timestamptz,
  add column if not exists usage_reported_until timestamptz;

-- Provider cost of a workspace in a period, in euro cents (api_usage.cost_micros is millionths of a euro).
create or replace function public.usage_cost_cents(p_org uuid, p_from timestamptz, p_to timestamptz default now())
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(cost_micros), 0)::bigint / 10000
  from public.api_usage
  where org_id = p_org and created_at >= p_from and created_at < p_to and status = 'ok';
$$;
revoke all on function public.usage_cost_cents(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.usage_cost_cents(uuid, timestamptz, timestamptz) to service_role;

-- Cost per provider/operation for the billing page breakdown.
create or replace function public.usage_breakdown(p_org uuid, p_from timestamptz)
returns table (provider text, operation text, calls bigint, cost_micros bigint)
language sql stable security definer set search_path = '' as $$
  select u.provider::text, u.operation, count(*)::bigint, coalesce(sum(u.cost_micros), 0)::bigint
  from public.api_usage u
  where u.org_id = p_org and u.created_at >= p_from and u.status = 'ok'
    and exists (select 1 from public.organization_members m where m.org_id = p_org and m.user_id = (select auth.uid()))
  group by 1, 2;
$$;
grant execute on function public.usage_breakdown(uuid, timestamptz) to authenticated;

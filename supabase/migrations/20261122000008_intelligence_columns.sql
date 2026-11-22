-- Latest website signals denormalised onto the business for fast filtering in
-- the lead database (digital presence filters).
alter table public.businesses
  add column digital_signals jsonb,
  add column recommended_service text;

create index businesses_signals_gin on public.businesses using gin (digital_signals jsonb_path_ops);

-- Only one research run per business at a time.
create unique index website_analyses_active_uidx on public.website_analyses (business_id)
  where status in ('queued', 'running');

-- Golden-record provenance + KVK non-mailing indicator.
alter table public.businesses
  add column kvk_non_mailing boolean not null default false,
  add column golden_sources jsonb not null default '{}'::jsonb,
  add column registration_date date,
  add column rating numeric(2, 1),
  add column review_count integer;

alter table public.business_locations
  add column golden_sources jsonb not null default '{}'::jsonb;

create index businesses_org_nonmailing_idx on public.businesses (org_id) where kvk_non_mailing;

-- kvk_non_mailing and golden_sources are system-managed.
create or replace function private.guard_business_system_columns()
returns trigger language plpgsql as $$
begin
  if private.is_end_user_request() then
    if tg_op = 'INSERT' and (new.is_mock or new.kvk_non_mailing) then
      raise exception 'system-managed column cannot be set directly' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.is_mock is distinct from old.is_mock
        or new.org_id is distinct from old.org_id
        or new.kvk_non_mailing is distinct from old.kvk_non_mailing
        or new.golden_sources is distinct from old.golden_sources) then
      raise exception 'system-managed column cannot be changed directly' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

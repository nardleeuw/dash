-- Full unique constraints (NULLs are distinct) so PostgREST upserts can target them.
drop index if exists public.suppression_records_email_uidx;
alter table public.suppression_records add constraint suppression_records_org_email_key unique (org_id, email);

drop index if exists public.contacts_org_email_uidx;
alter table public.contacts add constraint contacts_org_email_key unique (org_id, email);

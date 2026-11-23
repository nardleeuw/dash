-- Writing preferences per sender profile: how much personalisation and u/je.
alter table public.agency_profiles
  add column if not exists personalization text not null default 'subtle' check (personalization in ('subtle', 'balanced', 'strong')),
  add column if not exists formality text not null default 'formal' check (formality in ('formal', 'informal'));

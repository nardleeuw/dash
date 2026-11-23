-- Senders are identified by name only; no postal address is stored or shown.
update public.organizations set postal_address = null where postal_address is not null;
comment on column public.organizations.postal_address is 'Unused: the app no longer stores or shows a postal address.';

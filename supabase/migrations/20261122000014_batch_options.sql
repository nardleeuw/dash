-- Generation options per batch: { "research": bool, "findEmails": bool }.
alter table public.email_generation_batches add column if not exists options jsonb not null default '{}'::jsonb;

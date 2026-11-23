-- New workspaces start inactive (no free allowance): signup + payment gives access.
update public.plans
set name = 'Nog niet actief', description = 'Kies een abonnement om te starten',
    limits = '{"users": 2, "search": 0, "enrichment": 0, "research": 0, "email_generation": 0, "send": 0}'::jsonb
where key = 'trial';

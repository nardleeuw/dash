-- Allow a small number of sends during the trial so agencies can try the full flow.
update public.plans set limits = jsonb_set(limits, '{send}', '50') where key = 'trial';

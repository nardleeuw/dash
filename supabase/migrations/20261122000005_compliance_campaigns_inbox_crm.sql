-- =============================================================================
-- Compliance (permissions, suppression, data-subject requests, privacy notices),
-- sending infrastructure, campaigns, inbox and CRM.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Compliance
-- -----------------------------------------------------------------------------
-- Documented legal basis for sending commercial email to a specific address.
create table public.email_permissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null,
  contact_id uuid,
  business_id uuid,
  basis public.permission_basis not null,
  recipient_category public.recipient_category not null,
  purpose text not null,
  source text not null,                 -- where/how it was obtained (form, contract, event…)
  evidence text not null,               -- description of the evidence
  evidence_url text,
  evidence_file_path text,              -- Supabase Storage path (bucket: compliance-evidence)
  obtained_at timestamptz not null,
  expires_at timestamptz,
  -- Required when basis = other_statutory_exception
  justification text,
  revoked_at timestamptz,
  revoked_reason text,
  recorded_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete set null (contact_id),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete set null (business_id),
  check (basis <> 'other_statutory_exception' or char_length(coalesce(justification, '')) >= 20),
  check (basis <> 'none'),
  check (obtained_at <= now() + interval '1 day')
);
create index email_permissions_org_email_idx on public.email_permissions (org_id, email);
create trigger email_permissions_updated_at before update on public.email_permissions
  for each row execute function private.set_updated_at();
create trigger email_permissions_audit after insert or update or delete on public.email_permissions
  for each row execute function private.audit_row_change();

create table public.suppression_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- Either a full address or an entire domain is suppressed.
  email extensions.citext,
  domain extensions.citext,
  reason public.suppression_reason not null,
  source text not null default 'manual',
  campaign_id uuid,
  note text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (email is not null or domain is not null)
);
create unique index suppression_records_email_uidx on public.suppression_records (org_id, email) where email is not null;
create unique index suppression_records_domain_uidx on public.suppression_records (org_id, domain) where domain is not null and email is null;
create trigger suppression_records_audit after insert or update or delete on public.suppression_records
  for each row execute function private.audit_row_change();

create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null,
  type text not null check (type in ('access', 'deletion', 'objection', 'rectification', 'restriction')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'rejected')),
  received_at timestamptz not null default now(),
  due_at timestamptz not null default (now() + interval '30 days'),
  completed_at timestamptz,
  notes text,
  handled_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index data_subject_requests_org_idx on public.data_subject_requests (org_id, status);
create trigger data_subject_requests_updated_at before update on public.data_subject_requests
  for each row execute function private.set_updated_at();
create trigger data_subject_requests_audit after insert or update on public.data_subject_requests
  for each row execute function private.audit_row_change();

create table public.privacy_notices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  version integer not null,
  language text not null default 'nl' check (language in ('nl', 'en')),
  -- Short notice appended to every outgoing email (who we are, why, how to object).
  email_footer text not null,
  url text,
  is_active boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, language, version)
);

-- -----------------------------------------------------------------------------
-- Sending accounts (credentials live in email_account_secrets — server only)
-- -----------------------------------------------------------------------------
create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid,
  provider public.email_provider not null,
  email_address extensions.citext not null,
  display_name text,
  smtp_host text,
  smtp_port integer,
  smtp_secure boolean,
  imap_host text,
  imap_port integer,
  imap_secure boolean,
  username text,
  daily_limit integer not null default 50 check (daily_limit between 1 and 2000),
  hourly_limit integer not null default 10 check (hourly_limit between 1 and 500),
  min_delay_seconds integer not null default 90 check (min_delay_seconds >= 10),
  status text not null default 'active' check (status in ('active', 'paused', 'error', 'disconnected')),
  last_error text,
  last_sent_at timestamptz,
  is_mock boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, email_address),
  foreign key (org_id, client_id) references public.agency_clients (org_id, id) on delete set null (client_id)
);
create trigger email_accounts_updated_at before update on public.email_accounts
  for each row execute function private.set_updated_at();

create table public.email_account_secrets (
  email_account_id uuid primary key references public.email_accounts (id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

create table public.email_account_sync_state (
  email_account_id uuid primary key references public.email_accounts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  cursor jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Campaigns
-- -----------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid,
  name text not null check (char_length(name) between 1 and 160),
  status public.campaign_status not null default 'draft',
  email_account_id uuid,
  agency_profile_id uuid,
  follow_up_sequence_id uuid,
  timezone text not null default 'Europe/Amsterdam',
  -- ISO weekdays 1=Mon..7=Sun
  send_days integer[] not null default '{1,2,3,4,5}',
  send_window_start time not null default '09:00',
  send_window_end time not null default '17:00',
  daily_limit integer not null default 40 check (daily_limit between 1 and 2000),
  starts_at timestamptz,
  launched_at timestamptz,
  paused_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, client_id) references public.agency_clients (org_id, id) on delete set null (client_id),
  foreign key (org_id, email_account_id) references public.email_accounts (org_id, id) on delete set null (email_account_id),
  foreign key (org_id, agency_profile_id) references public.agency_profiles (org_id, id) on delete set null (agency_profile_id),
  foreign key (org_id, follow_up_sequence_id) references public.follow_up_sequences (org_id, id) on delete set null (follow_up_sequence_id),
  check (send_window_start < send_window_end)
);
create index campaigns_org_idx on public.campaigns (org_id, created_at desc);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function private.set_updated_at();
create trigger campaigns_audit after insert or update of status on public.campaigns
  for each row execute function private.audit_row_change();

alter table public.generated_emails
  add foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade;

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  campaign_id uuid not null,
  business_id uuid not null,
  contact_id uuid,
  email extensions.citext not null,
  generated_email_id uuid not null,
  status public.recipient_status not null default 'pending',
  current_step integer not null default 0,
  next_send_at timestamptz,
  last_sent_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  -- A recipient address appears at most once per campaign.
  unique (campaign_id, email),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade,
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete set null (contact_id),
  foreign key (org_id, generated_email_id) references public.generated_emails (org_id, id)
);
create index campaign_recipients_due_idx on public.campaign_recipients (status, next_send_at) where status = 'active';
create index campaign_recipients_campaign_idx on public.campaign_recipients (campaign_id, status);
create trigger campaign_recipients_updated_at before update on public.campaign_recipients
  for each row execute function private.set_updated_at();

-- Every individual outgoing message. One row per (recipient, step): the unique
-- constraint is the database-level guarantee against duplicate sends.
create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  campaign_id uuid,
  campaign_recipient_id uuid,
  conversation_id uuid,
  business_id uuid,
  contact_id uuid,
  generated_email_id uuid,
  email_account_id uuid not null,
  sequence_step integer not null default 0,
  to_email extensions.citext not null,
  from_email extensions.citext not null,
  subject text not null,
  body_text text not null,
  message_id_header text not null unique,
  in_reply_to text,
  provider_message_id text,
  thread_id text,
  status public.message_status not null default 'queued',
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  error text,
  is_mock boolean not null default false,
  sent_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete set null (campaign_id),
  foreign key (org_id, campaign_recipient_id) references public.campaign_recipients (org_id, id) on delete set null (campaign_recipient_id),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete set null (business_id),
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete set null (contact_id),
  foreign key (org_id, generated_email_id) references public.generated_emails (org_id, id) on delete set null (generated_email_id),
  foreign key (org_id, email_account_id) references public.email_accounts (org_id, id)
);
create unique index outbound_messages_recipient_step_uidx on public.outbound_messages (campaign_recipient_id, sequence_step)
  where campaign_recipient_id is not null;
create index outbound_messages_account_sent_idx on public.outbound_messages (email_account_id, sent_at desc);
create index outbound_messages_org_idx on public.outbound_messages (org_id, created_at desc);
create index outbound_messages_status_idx on public.outbound_messages (status, scheduled_for);
create trigger outbound_messages_updated_at before update on public.outbound_messages
  for each row execute function private.set_updated_at();

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  outbound_message_id uuid,
  email_account_id uuid,
  type public.email_event_type not null,
  provider text not null,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (org_id, outbound_message_id) references public.outbound_messages (org_id, id) on delete cascade,
  foreign key (org_id, email_account_id) references public.email_accounts (org_id, id) on delete set null (email_account_id)
);
create unique index email_events_provider_uidx on public.email_events (provider, provider_event_id) where provider_event_id is not null;
create index email_events_message_idx on public.email_events (outbound_message_id);
create index email_events_org_type_idx on public.email_events (org_id, type, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Inbox
-- -----------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  business_id uuid,
  contact_id uuid,
  campaign_id uuid,
  campaign_recipient_id uuid,
  email_account_id uuid,
  subject text,
  participant_email extensions.citext,
  latest_category public.reply_category,
  status text not null default 'open' check (status in ('open', 'closed')),
  needs_attention boolean not null default true,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete set null (business_id),
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete set null (contact_id),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete set null (campaign_id),
  foreign key (org_id, campaign_recipient_id) references public.campaign_recipients (org_id, id) on delete set null (campaign_recipient_id),
  foreign key (org_id, email_account_id) references public.email_accounts (org_id, id) on delete set null (email_account_id)
);
create unique index conversations_recipient_uidx on public.conversations (campaign_recipient_id) where campaign_recipient_id is not null;
create index conversations_org_idx on public.conversations (org_id, last_message_at desc);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();

alter table public.outbound_messages
  add foreign key (org_id, conversation_id) references public.conversations (org_id, id) on delete set null (conversation_id);

create table public.replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  conversation_id uuid,
  email_account_id uuid,
  outbound_message_id uuid,
  from_email extensions.citext not null,
  from_name text,
  to_email extensions.citext,
  subject text,
  body_text text,
  message_id_header text not null,
  in_reply_to text,
  references_headers text[] not null default '{}',
  received_at timestamptz not null,
  matched_by text not null default 'none' check (matched_by in ('in_reply_to', 'references', 'sender', 'none')),
  ai_category public.reply_category,
  ai_confidence numeric(3, 2),
  ai_summary text,
  suggested_next_step text,
  is_auto_reply boolean not null default false,
  is_mock boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, conversation_id) references public.conversations (org_id, id) on delete cascade,
  foreign key (org_id, email_account_id) references public.email_accounts (org_id, id) on delete set null (email_account_id),
  foreign key (org_id, outbound_message_id) references public.outbound_messages (org_id, id) on delete set null (outbound_message_id)
);
create unique index replies_message_uidx on public.replies (org_id, message_id_header);
create index replies_conversation_idx on public.replies (conversation_id, received_at);

-- -----------------------------------------------------------------------------
-- CRM
-- -----------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  business_id uuid,
  contact_id uuid,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  due_at timestamptz,
  assignee_id uuid references public.users (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'done')),
  completed_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete cascade
);
create index tasks_org_status_idx on public.tasks (org_id, status, due_at);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  business_id uuid,
  contact_id uuid,
  body text not null check (char_length(body) between 1 and 20000),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete cascade
);
create index notes_business_idx on public.notes (business_id, created_at desc);
create trigger notes_updated_at before update on public.notes
  for each row execute function private.set_updated_at();

-- User-facing activity history per business.
create table public.activities (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  business_id uuid,
  contact_id uuid,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  actor_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, business_id) references public.businesses (org_id, id) on delete cascade,
  foreign key (org_id, contact_id) references public.contacts (org_id, id) on delete cascade
);
create index activities_business_idx on public.activities (business_id, created_at desc);
create index activities_org_idx on public.activities (org_id, created_at desc);

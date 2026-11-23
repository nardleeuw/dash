#!/usr/bin/env node
/**
 * Create (or reuse) a hosted Supabase project and apply all migrations through
 * the Supabase Management API (HTTPS only — works behind restrictive proxies).
 *
 *   SUPABASE_ACCESS_TOKEN=...  (personal access token)
 *   SUPABASE_PROJECT_REF=...   (optional: reuse an existing project)
 *   SUPABASE_ORG_ID=...        (optional: defaults to your first organization)
 *   SUPABASE_REGION=eu-central-1
 *   APP_URL=https://your-app.vercel.app
 *   PRINT_SECRETS=1            (optional: print the service-role key and DB password)
 *
 *   node scripts/deploy-supabase.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const API = "https://api.supabase.com/v1";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function api(method, url, body) {
  const res = await fetch(`${API}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ref = process.env.SUPABASE_PROJECT_REF;
let dbPassword = null;
if (!ref) {
  const orgs = await api("GET", "/organizations");
  const orgId = process.env.SUPABASE_ORG_ID ?? orgs[0]?.id;
  if (!orgId) throw new Error("No Supabase organization found");
  dbPassword = crypto.randomBytes(24).toString("base64url");
  const project = await api("POST", "/projects", {
    name: process.env.SUPABASE_PROJECT_NAME ?? "leadwerk",
    organization_id: orgId,
    region: process.env.SUPABASE_REGION ?? "eu-central-1",
    db_pass: dbPassword,
  });
  ref = project.id ?? project.ref;
  console.log(`Created project ${ref}; waiting until it is healthy…`);
}
for (let i = 0; i < 90; i++) {
  const p = await api("GET", `/projects/${ref}`);
  if (p.status === "ACTIVE_HEALTHY") break;
  if (i === 89) throw new Error(`Project not healthy: ${p.status}`);
  await sleep(10_000);
}

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
await api("POST", `/projects/${ref}/database/query`, { query: "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);" });
const applied = new Set((await api("POST", `/projects/${ref}/database/query`, { query: "select version from supabase_migrations.schema_migrations" })).map((r) => r.version));
for (const file of files) {
  const version = file.split("_")[0];
  if (applied.has(version)) {
    console.log(`= ${file} (already applied)`);
    continue;
  }
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  await api("POST", `/projects/${ref}/database/query`, { query: sql });
  await api("POST", `/projects/${ref}/database/query`, { query: `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${file.replace(/'/g, "")}')` });
  console.log(`+ ${file}`);
}

const appUrl = process.env.APP_URL;
if (appUrl) {
  await api("PATCH", `/projects/${ref}/config/auth`, { site_url: appUrl, uri_allow_list: `${appUrl}/**`, mailer_autoconfirm: false });
  console.log(`Auth site URL set to ${appUrl}`);
}

// Background jobs: Supabase pg_cron calls the app's /api/cron/* routes via
// pg_net. This works on every Vercel plan (Hobby only allows daily Vercel
// crons). CRON_SECRET is kept in Supabase Vault, never in the job text.
const cronSecret = process.env.CRON_SECRET;
if (appUrl && cronSecret) {
  if (!/^[A-Za-z0-9_\-+/=]{24,}$/.test(cronSecret)) throw new Error("CRON_SECRET must be a base64/base64url string of 24+ chars");
  const origin = new URL(appUrl).origin;
  const q = (query) => api("POST", `/projects/${ref}/database/query`, { query });
  await q("create extension if not exists pg_cron; create extension if not exists pg_net with schema extensions;");
  await q(`do $$ begin
    if exists (select 1 from vault.secrets where name = 'leadwerk_cron_secret') then
      perform vault.update_secret((select id from vault.secrets where name = 'leadwerk_cron_secret'), $s$${cronSecret}$s$);
    else
      perform vault.create_secret($s$${cronSecret}$s$, 'leadwerk_cron_secret');
    end if;
  end $$;`);
  const jobs = [
    ["leadwerk-campaigns-tick", "*/5 * * * *", "campaigns-tick"],
    ["leadwerk-inbox-sync", "*/10 * * * *", "inbox-sync"],
    ["leadwerk-emails-resume", "*/5 * * * *", "emails-resume"],
    ["leadwerk-retention-purge", "17 3 * * *", "retention-purge"],
  ];
  for (const [name, schedule, job] of jobs) {
    await q(`select cron.schedule('${name}', '${schedule}', $job$
      select net.http_get(
        url := '${origin}/api/cron/${job}',
        headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'leadwerk_cron_secret')),
        timeout_milliseconds := 120000
      );
    $job$);`);
    console.log(`Scheduled ${name} (${schedule}) → ${origin}/api/cron/${job}`);
  }
}

const keys = await api("GET", `/projects/${ref}/api-keys`);
const anon = keys.find((k) => k.name === "anon")?.api_key;
const service = keys.find((k) => k.name === "service_role")?.api_key;
console.log("\n# Add these to your Vercel environment (never commit them):");
console.log(`NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`);
console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`);
// Secrets are only printed on request so they do not end up in CI or agent logs.
const printSecrets = process.env.PRINT_SECRETS === "1";
console.log(`SUPABASE_SERVICE_ROLE_KEY=${!service ? "(not available)" : printSecrets ? "<printed to stderr>" : "<hidden — rerun with PRINT_SECRETS=1 or copy it from the dashboard>"}`);
if (service && printSecrets) console.error(`SUPABASE_SERVICE_ROLE_KEY=${service}`);
if (dbPassword && printSecrets) console.error(`# Database password (store in a password manager): ${dbPassword}`);
if (dbPassword && !printSecrets) console.log("# Database password not shown; reset it in the dashboard (Project Settings → Database) if you need direct access.");

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

const keys = await api("GET", `/projects/${ref}/api-keys`);
const anon = keys.find((k) => k.name === "anon")?.api_key;
const service = keys.find((k) => k.name === "service_role")?.api_key;
console.log("\n# Add these to your Vercel environment (never commit them):");
console.log(`NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`);
console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY=${service ? "<printed to stderr>" : "(not available)"}`);
if (service) console.error(`SUPABASE_SERVICE_ROLE_KEY=${service}`);
if (dbPassword) console.error(`# Database password (store in a password manager): ${dbPassword}`);

-- Run once in the Supabase SQL editor.
create table if not exists people (
  login text primary key,
  name text, company text, company_norm text, company_domain text,
  bio text, website text, location text, twitter text, linkedin text,
  github_email text, followers int,
  repos text[] default '{}', signals text[] default '{}',
  last_seen timestamptz,
  score int, qualified boolean,
  fetched_at timestamptz
);
create index if not exists people_qualified_score on people (qualified, score desc);

-- TypeSafe judgments + composite rank (added after the first review). Safe to re-run.
alter table people
  add column if not exists rank int,
  add column if not exists reasoning text,
  add column if not exists persona text,
  add column if not exists persona_p numeric,
  add column if not exists adoption numeric,
  add column if not exists security_influence numeric,
  add column if not exists real_company numeric,
  add column if not exists enterprise numeric,
  add column if not exists judge_confidence numeric,
  add column if not exists ranked_at timestamptz,
  add column if not exists maintainer boolean default false;
create index if not exists people_rank on people (qualified, rank desc nulls last);

create table if not exists contacts (
  login text primary key references people (login),
  email text, email_source text,
  first_name text, last_name text, title text,
  company text, company_domain text, linkedin text,
  tools_used text[] default '{}',
  enriched_at timestamptz default now()
);
-- true when the email's domain equals company_domain; false = likely old employer / side project; null = unknown
alter table contacts add column if not exists email_domain_match boolean;

create table if not exists spend (
  id bigserial primary key,
  run_id text not null, login text, tool text, usd numeric not null,
  created_at timestamptz default now()
);
create index if not exists spend_run on spend (run_id);
-- idempotency key of the Deepline execution; replays never double-count
alter table spend add column if not exists key text;
create unique index if not exists spend_key on spend (key);

-- Used by enrich-batch: qualified people not yet enriched, plus people a free-only run touched
-- (no paid tool used, no work email) so a later paid run can pick them up.
-- Re-run this after adding columns to people: a view freezes p.* at creation time.
create or replace view people_to_enrich as
  select p.* from people p left join contacts c on c.login = p.login
  where p.qualified
    and (c.login is null
         or (cardinality(c.tools_used) = 0 and c.email_source in ('none', 'skipped_cap', 'github_profile_personal')));

-- Spend so far for one enrich run; used by enrich-person before every paid call.
create or replace function run_spend(rid text) returns numeric language sql stable as
  $$ select coalesce(sum(usd), 0) from spend where run_id = rid $$;

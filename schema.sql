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

-- people_to_enrich is defined at the bottom of this file (after every `alter table people`).

-- Spend so far for one enrich run; used by enrich-person before every paid call.
create or replace function run_spend(rid text) returns numeric language sql stable as
  $$ select coalesce(sum(usd), 0) from spend where run_id = rid $$;

-- ---- ICP gate, outreach channel, LinkedIn activity (added 2026-10-14) ---------------------------
-- One row per company. key = alnum(company_norm), or company_domain when the profile has no company name.
-- icp_fit: true/false from the owner's ICP (client-profile.yaml icp_hard_filters); null = unknown or
-- the provider returned a different company than asked for (icp_reason says which). Unknown is held, never dropped.
create table if not exists companies (
  key text primary key,
  name text, domain text, linkedin text,
  employees int, employees_min int, employees_max int, hq_country text, industry text,
  icp_fit boolean, icp_reason text, source text,
  checked_at timestamptz
);
-- spend.login holds the company key for company lookups.
alter table people
  add column if not exists company_key text,
  add column if not exists icp_fit boolean;  -- denormalised from companies so enrich can filter on one column
create index if not exists people_company_key on people (company_key);

-- LinkedIn activity, checked before LinkedIn outreach. Reactions carry no date, so they only feed the count.
create table if not exists linkedin_activity (
  login text primary key references people (login),
  linkedin text,
  posts_30d int, posts_90d int, comments_30d int, comments_90d int, reactions int,
  last_activity_at timestamptz, days_since_last_activity int,
  activity_status text,   -- active (<=30d) | stale (31-90d) | inactive (>90d or nothing dated)
  activity_level text,    -- minimal | low | moderate | high  (posts+comments in 90d + reactions: 0 / 1-2 / 3-9 / 10+)
  outreach_ready boolean, reason text,
  checked_at timestamptz default now()
);

-- Recreated here because people gained columns above (a view freezes p.* at creation time).
create or replace view people_to_enrich as
  select p.* from people p left join contacts c on c.login = p.login
  where p.qualified
    and (c.login is null
         or (cardinality(c.tools_used) = 0 and c.email_source in ('none', 'skipped_cap', 'github_profile_personal')));

-- What a rep works from. channel: email when we have one; linkedin when there is a profile URL but no
-- email; none otherwise. (Relaxed 2026-10-14: no longer requires a company domain.)
create or replace view outreach_queue as
  select p.login, p.name, p.company_norm, p.company_key,
         coalesce(c.company_domain, p.company_domain) as company_domain,
         p.rank, p.icp_fit, c.email, c.email_source, c.title,
         coalesce(c.linkedin, p.linkedin) as linkedin,
         case when c.email is not null then 'email'
              when coalesce(c.linkedin, p.linkedin) is not null then 'linkedin'
              else 'none' end as channel,
         a.activity_status, a.activity_level, a.outreach_ready, a.days_since_last_activity
  from people p
  left join contacts c on c.login = p.login
  left join linkedin_activity a on a.login = p.login
  where p.qualified and coalesce(p.maintainer, false) = false;

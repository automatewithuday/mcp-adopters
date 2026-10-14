# mcp-adopters

**Find the engineers and teams adopting the Model Context Protocol, rank them, and get a work email
for the ones worth talking to.** One command at a time, your own keys, a hard cap on spend.

MIT licensed. Built by [martechs.io](https://martechs.io) for outbound teams selling to companies
wiring AI agents into their stack, for example MCP security testing. Works for anything where "they
use MCP" is the buying signal.

## What it does, in plain English

1. **Finds people.** Everyone who starred, forked, filed an issue, or sent a pull request to a list of
   MCP server repos. Fork, issue, and PR are real usage; a star is interest.
2. **Reads their GitHub profile.** Name, company, bio, website, LinkedIn, public email.
3. **Throws out the noise.** Students, schools, bots, freelancers, empty profiles, and people who work
   for the vendor that ships the repo (they sell MCP, they don't buy security for it).
4. **Ranks the rest 0 to 100** with a small AI model that answers five fixed questions per person
   (role, real employer, how far along with MCP, influence over security decisions, known enterprise)
   and writes one line of reasoning a rep can read.
5. **Finds a work email and title**, cheapest source first, only for people above a rank you choose,
   and stops when a run hits the dollar cap you set.

Everything lands in three Supabase tables you can open, filter, and export as CSV.

```
GH Archive mirror (free)  ──►  people  ──►  rules  ──►  AI rank  ──►  enrichment  ──►  contacts
   stars / forks / PRs          profiles      qualified     0-100 + why    email + title      CSV
```

## Why not the GitHub stargazers API?

GitHub restricted it to repo admins in July 2026. The public GH Archive mirror on
[play.clickhouse.com](https://play.clickhouse.com) still carries every public star, fork, issue, and PR
event with the actor's login, free and without a key. That's the source.

## A real run, with the bill

October 2026, 10 seed repos (the official MCP servers and SDKs, plus GitHub, Microsoft Playwright,
Figma, AWS, Google, FastMCP, and mcp-go), last 60 days, first 300 profiles.

| stage | people |
|---|---|
| actors found (stars, forks, issues, PRs) | 713 |
| profiles read from GitHub | 377 |
| passed the rules | 104 |
| flagged as vendor employees (skipped) | 12 |
| rank ≥ 40 | 34 |
| sent to paid enrichment (rank ≥ 55) | 15 |
| came back with an email | 14 |
| came back with a title | 9 |

| cost item | amount |
|---|---|
| GitHub, GH Archive mirror | $0 |
| AI ranking, 104 people | under $0.01 |
| person enrichment, 13 calls at $0.20 | $2.60 |
| LinkedIn → email, 7 calls at $0.028, 6 hits | $0.20 |
| name + domain → email, 1 call | $0.01 |
| **total** | **$2.81** |

The ledger in Supabase matched the provider's balance change to the cent. Scaling the same funnel to a
full year of activity on the same repos is roughly 17,000 actors, 5,000 qualified, and a paid pass you
cap wherever you like; the expensive step is ~$0.20 per person who reaches it.

What the ranked list looked like at the top: a staff engineer at an ed-tech company who forked two MCP
repos and sent a PR, engineers at Apple, Netflix, NVIDIA, Dell, Cloudflare, and Fidelity who filed
issues or PRs, and the CEO of a company that ships an MCP framework (flagged as a vendor, skipped).

## What you need

| | for | cost |
|---|---|---|
| Node 20+ | running it | |
| [Supabase](https://supabase.com) project | the three tables | free tier |
| GitHub token | profile reads; a classic token with only `read:user` | free |
| [TypeSafe](https://typesafe.ai) key | ranking | $0.042 per million tokens, ~800 tokens a person |
| an enrichment provider | emails and titles | per result, see above; ships with one implementation, add your own |
| [Trigger.dev](https://trigger.dev) project | optional, for scheduled cloud runs | free tier |

## Setup

```bash
git clone https://github.com/automatewithuday/mcp-adopters.git && cd mcp-adopters
npm install
cp .env.example .env     # fill in the keys
```

Paste `schema.sql` into the Supabase SQL editor and run it (safe to re-run). `repos.json` is the source list:
`npx tsx scripts/run.ts discover` refreshes it from GitHub search (MCP in the repo name, 1000+ stars; entries
marked `curated` are kept). Review the diff before fetching.

## Run

```bash
npm test
npx tsx scripts/run.ts fetch --days 60 --limit 300   # find actors, read the first 300 profiles
npx tsx scripts/run.ts fetch --source builders        # people pushing to someone else's MCP-named repo (free, GH Archive)
npx tsx scripts/run.ts rank                           # AI rank for everyone who passed the rules
npx tsx scripts/run.ts report                         # funnel + top 20 with reasoning
npx tsx scripts/run.ts enrich --run-id pilot --max-usd 10 --min-rank 55 --limit 50
```

With an ICP (optional, company-level gate before paid enrichment):

```bash
# client-profile.yaml is what the icp-onboarding skill writes; only icp_hard_filters.headcount_min/max and .countries are read
npx tsx scripts/run.ts icp --icp ~/path/client-profile.yaml --run-id icp1 --max-usd 1   # headcount + HQ per company, $0.003 each; only companies with someone at rank ≥ --min-rank
npx tsx scripts/run.ts enrich --icp ~/path/client-profile.yaml --run-id pilot --max-usd 10 --min-rank 55
npx tsx scripts/run.ts activity --icp ~/path/client-profile.yaml --run-id act1 --max-usd 1 --min-rank 40  # LinkedIn activity, ~$0.01/profile
```

`icp` looks each company up once (LinkedIn company page via your provider), checks it is the right
company (domain match, or exact name when no domain was known), and writes `icp_fit` true/false/null.
Null means "couldn't tell" and is held, not dropped; `companies.icp_reason` says why. With `--icp`,
`enrich` and `activity` only take people whose company passed. Without it, nothing changes.

`activity` runs for people on the `linkedin` channel (profile URL, no email):
posts, comments and reactions → `active` (≤30 days), `stale` (31–90), `inactive`, plus `outreach_ready`.

Useful extras:

```bash
npx tsx scripts/run.ts reprofile              # re-apply the rules after you change them
npx tsx scripts/run.ts rank --force           # re-rank after you change weights or questions
npx tsx scripts/run.ts enrich --run-id free --max-usd 0 --limit 30   # free sources only, no provider calls
```

`enrich` resumes if you re-run the same `--run-id`: people already done are skipped and repeated
provider calls are replayed for free. Export: Supabase → `contacts` → Download CSV; the columns match
Smartlead and Instantly imports.

### On Trigger.dev instead

```bash
npx trigger.dev@latest login     # then put your project ref in trigger.config.ts
npx trigger.dev dev
```

Tasks `fetch-actors` `{ "days": 365 }`, `rank-people` `{ }`, `enrich-batch` `{ "runId": "pilot", "minRank": 55, "maxUsd": 50 }`,
`icp-batch` `{ "runId": "icp1", "maxUsd": 1, "icp": { "headcount_min": 100, "headcount_max": 5000, "countries": ["US", "CA"] } }`,
`activity-batch` `{ "runId": "act1", "maxUsd": 1, "requireIcp": true }`. They call the same functions as the CLI.

## Bring your own enrichment provider

The pipeline asks a provider for five things, defined in `src/lib/providers/types.ts` (the last two
only matter if you use the ICP gate and the LinkedIn activity check):

| call | input | returns |
|---|---|---|
| `emailFromNameDomain` | first name, last name, company domain | email |
| `emailFromLinkedin` | LinkedIn URL | email, company domain |
| `enrichPerson` | an email or a social profile URL (a GitHub URL works) | title, company, domain, LinkedIn, email |

Each call reports what it cost and a stable key so retries never double-charge. Write
`src/lib/providers/<name>.ts`, register it in `providers/index.ts`, set `ENRICH_PROVIDER=<name>`.
The shipped implementation routes the three calls to Datagma, Findymail, and People Data Labs through
one aggregator account. Any provider with a name-to-email, LinkedIn-to-email, and person-enrich endpoint
will do; most aggregators expose all three.

## Tuning without touching the pipeline

| what | where |
|---|---|
| seed repos | `repos.json` (regenerate with `discover`) |
| which company names count as "works for the vendor" | `src/repos.ts` |
| drop rules and the rule score | `src/lib/qualify.ts` (tests in `qualify.test.ts`) |
| the five AI questions and the rank weights (35% adoption, 30% security influence, 20% real company, 15% role) | top of `src/lib/rank.ts` |
| enrichment order and spend cap behaviour | `src/lib/pipeline.ts` |

Raw AI judgments are stored per person, so changing weights only needs `rank --force`, no new inference.

## Columns a rep will use

- `people.rank` and `people.reasoning`, e.g.
  `Eng leader (99%) · MCP: building/running MCP — forked + PR on github-mcp-server, typescript-sdk; bio: staff, ai · owns security or leads eng (60% conf) · operating company Montanha Tech (91%)`
- `people.signals`: star, fork, issue, PR. `people.maintainer`: vendor employee, skipped by enrichment.
- `contacts.email_source`: `github_profile`, `github_profile_personal`, `name_domain`, `linkedin`,
  `person_enrich`, `none`, `skipped_cap`.
- `contacts.email_domain_match`: `false` usually means a previous employer or a side project. Expect
  the odd false alarm (dell.com vs delltechnologies.com).
- `spend`: every paid call with its cost, per run (`login` holds the company key for company lookups).
- `people.icp_fit` / `companies`: the ICP verdict per company with `employees`, `hq_country`, `icp_reason`.
- `outreach_queue` (view): one row per qualified non-vendor person with `channel` = `email` | `linkedin` (profile URL, no email) | `none`,
  plus `icp_fit`, `activity_status` and `outreach_ready`. Filter `channel = 'linkedin' and outreach_ready` for a LinkedIn list.
- `linkedin_activity`: `activity_status` (`active` ≤30d, `stale` 31–90d, `inactive`), `activity_level`
  (`minimal` 0, `low` 1–2, `moderate` 3–9, `high` 10+ actions in 90d), `outreach_ready` (active, or stale with
  moderate+ volume), and a `reason` line. Thresholds are in `src/lib/activity.ts`.

## Compliance, read this

GitHub's Acceptable Use Policies prohibit using information from GitHub to send unsolicited email.
Public profile emails are tagged `github_profile` or `github_profile_personal` so you can exclude them
per campaign; emails from your enrichment provider carry other tags. Check the terms of every provider
you plug in and the email laws where you send. This tool builds a list; what you send is on you.

## Layout

```
schema.sql                 five tables + two views, idempotent
scripts/run.ts             the CLI
repos.json                 seed repos (owner-approved, from `discover`)
src/repos.ts               vendor aliases
src/lib/discover.ts        GitHub search → candidate repos
src/lib/clickhouse.ts      actors from the GH Archive mirror
src/lib/github.ts          profiles via GraphQL, 100 per call
src/lib/qualify.ts         rules and rule score
src/lib/rank.ts            AI questions, weights, reasoning line
src/lib/pipeline.ts        the steps the CLI and Trigger tasks share
src/lib/providers/         enrichment provider interface + shipped implementation
src/trigger/               thin Trigger.dev wrappers
```

# mcp-adopters — notes for Claude

v1.0 (2026-10-13), MIT. Public repo: provider-agnostic in docs and code; the owner's own setup uses Deepline.

- Run: `npx tsx scripts/run.ts <discover|fetch|reprofile|rank|icp|enrich|activity|report>`. Never bypass `--max-usd` or spend without the owner's go.
- Sources: `repos.json` (seed repos; `discover` regenerates, `curated` entries survive) and `fetch --source builders`
  (GH Archive push/create/release on MCP-named repos owned by someone else). Builder signals never set `maintainer`.
- All logic in `src/lib/`. `src/trigger/*` stay thin wrappers over `pipeline.ts`.
- Enrichment goes through `src/lib/providers/` (`EnrichProvider`: name+domain → email, LinkedIn → email, email/profile → person,
  name/domain → company firmographics, LinkedIn → activity).
  `providers/deepline.ts` is the shipped implementation; `ENRICH_PROVIDER` selects. Don't name providers in pipeline.ts.
- Qualification rules, rank weights, repo list (`repos.json`, star floor, curated adds), waterfall order, activity thresholds (`activity.ts`) are owner decisions: propose, don't edit silently.
- `icp` only checks companies with a person at rank ≥ `--min-rank` (default 40); unranked people don't count, run `rank` first.
- ICP thresholds live in the owner's `client-profile.yaml` (`icp_hard_filters`), never in code. `icp.ts` reads headcount + countries only.
  ICP is a gate on paid enrichment (`people.icp_fit`, denormalised from `companies`), not a rank weight. Unknown (null) is held, never dropped.
- `companies.key` = `alnum(company_norm)` or `company_domain` when there is no company name (`companyKey` in `icp.ts`).
- Schema changes: `schema.sql` (idempotent), pasted by the owner; the service key can't run DDL.
  Recreate `people_to_enrich` after adding columns to `people` (views freeze `p.*`).
- Provider idempotency keys must hash the tool input (the same lookup runs twice per person).
- `npm test` and `npm run typecheck` must pass before handing over.
- Next: Trigger.dev wiring; company-resolution waterfall (domain lookup fallback) once the ICP unknown tail is large.

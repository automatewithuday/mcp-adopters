# mcp-adopters — notes for Claude

v1.0 (2026-10-13), MIT. Public repo: provider-agnostic in docs and code; the owner's own setup uses Deepline.

- Run: `npx tsx scripts/run.ts <fetch|reprofile|rank|icp|enrich|activity|report>`. Never bypass `--max-usd` or spend without the owner's go.
- All logic in `src/lib/`. `src/trigger/*` stay thin wrappers over `pipeline.ts`.
- Enrichment goes through `src/lib/providers/` (`EnrichProvider`: name+domain → email, LinkedIn → email, email/profile → person,
  name/domain → company firmographics, LinkedIn → activity).
  `providers/deepline.ts` is the shipped implementation; `ENRICH_PROVIDER` selects. Don't name providers in pipeline.ts.
- Qualification rules, rank weights, repo list, waterfall order, activity thresholds (`activity.ts`) are owner decisions: propose, don't edit silently.
- ICP thresholds live in the owner's `client-profile.yaml` (`icp_hard_filters`), never in code. `icp.ts` reads headcount + countries only.
  ICP is a gate on paid enrichment (`people.icp_fit`, denormalised from `companies`), not a rank weight. Unknown (null) is held, never dropped.
- `companies.key` = `alnum(company_norm)` or `company_domain` when there is no company name (`companyKey` in `icp.ts`).
- Schema changes: `schema.sql` (idempotent), pasted by the owner; the service key can't run DDL.
  Recreate `people_to_enrich` after adding columns to `people` (views freeze `p.*`).
- Provider idempotency keys must hash the tool input (the same lookup runs twice per person).
- `npm test` and `npm run typecheck` must pass before handing over.
- Next: scale fetch to 365 days, Trigger.dev wiring, repo widening + "builder" (code-search) source.

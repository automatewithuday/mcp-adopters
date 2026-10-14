import { task } from "@trigger.dev/sdk";
import { chunk, fetchActorsStep, fetchProfilesStep } from "../lib/pipeline.ts";
import { SEED_REPOS } from "../repos.ts";

/** Pull star/fork/issue/PR actors for the seed repos from the GH Archive mirror, then fan out profile fetches. */
export const fetchActors = task({
  id: "fetch-actors",
  maxDuration: 600,
  run: async (payload: { days?: number; repos?: string[]; source?: "repos" | "builders" }) => {
    const logins = await fetchActorsStep(payload.repos ?? SEED_REPOS, payload.days ?? 365, payload.source);
    const batches = chunk(logins, 100).map((l) => ({ payload: { logins: l } }));
    for (const b of chunk(batches, 1000)) await fetchProfiles.batchTrigger(b);
    return { actors: logins.length, profileBatches: batches.length };
  },
});

/** One GraphQL call for ≤100 logins, qualify, upsert. */
export const fetchProfiles = task({
  id: "fetch-profiles",
  concurrency: { total: 3 },
  retry: { maxAttempts: 5, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 120000 },
  run: (payload: { logins: string[] }) => fetchProfilesStep(payload.logins),
});

import { task } from "@trigger.dev/sdk";
import { chunk, activityCandidates, activityStep } from "../lib/pipeline.ts";

/** Fan out activity-person over linkedin-channel people with no activity row, best rank first. */
export const activityBatch = task({
  id: "activity-batch",
  run: async (payload: { runId: string; minRank?: number; maxUsd?: number; limit?: number; requireIcp?: boolean }) => {
    const people = await activityCandidates(payload.minRank ?? 40, payload.limit ?? 5000, payload.requireIcp ?? false);
    const items = people.map((p) => ({ payload: { ...p, runId: payload.runId, maxUsd: payload.maxUsd ?? 0 } }));
    for (const b of chunk(items, 1000)) await activityPerson.batchTrigger(b);
    return { queued: items.length };
  },
});

/** concurrency 1 keeps the spend-cap check race-free. */
export const activityPerson = task({
  id: "activity-person",
  concurrency: { total: 1 },
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 3000, maxTimeoutInMs: 60000 },
  run: (payload: { login: string; linkedin: string; runId: string; maxUsd: number }) => activityStep(payload),
});

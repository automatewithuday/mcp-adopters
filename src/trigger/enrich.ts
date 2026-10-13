import { task, wait } from "@trigger.dev/sdk";
import { chunk, enrichCandidates, enrichPersonStep } from "../lib/pipeline.ts";

/** Fan out enrich-person over qualified people with no contacts row, best score first. */
export const enrichBatch = task({
  id: "enrich-batch",
  run: async (payload: { runId: string; minRank?: number; maxUsd?: number; limit?: number }) => {
    const logins = await enrichCandidates(payload.minRank ?? 40, payload.limit ?? 5000);
    const items = logins.map((login) => ({ payload: { login, runId: payload.runId, maxUsd: payload.maxUsd ?? 0 } }));
    for (const b of chunk(items, 1000)) await enrichPerson.batchTrigger(b);
    return { queued: items.length };
  },
});

/** concurrency 1 keeps the spend-cap check race-free and holds PDL's 10 req/min limit. */
export const enrichPerson = task({
  id: "enrich-person",
  concurrency: { total: 1 },
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 3000, maxTimeoutInMs: 60000 },
  run: (payload: { login: string; runId: string; maxUsd: number }) => enrichPersonStep(payload, (s) => wait.for({ seconds: s })),
});

import { task } from "@trigger.dev/sdk";
import { chunk, icpCandidates, icpStep, type CompanyRef } from "../lib/pipeline.ts";
import type { Icp } from "../lib/icp.ts";

/** Fan out icp-company over companies with no verdict yet. `icp` is the parsed icp_hard_filters (workers have no YAML file). */
export const icpBatch = task({
  id: "icp-batch",
  run: async (payload: { runId: string; icp: Icp; maxUsd?: number; force?: boolean }) => {
    const companies = await icpCandidates(payload.force ?? false);
    const items = companies.map((c) => ({ payload: { ...c, runId: payload.runId, maxUsd: payload.maxUsd ?? 0, icp: payload.icp } }));
    for (const b of chunk(items, 1000)) await icpCompany.batchTrigger(b);
    return { queued: items.length };
  },
});

/** concurrency 1 keeps the spend-cap check race-free. */
export const icpCompany = task({
  id: "icp-company",
  concurrency: { total: 1 },
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 3000, maxTimeoutInMs: 60000 },
  run: (payload: CompanyRef & { runId: string; maxUsd: number; icp: Icp }) => icpStep(payload),
});

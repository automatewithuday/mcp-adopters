import { task } from "@trigger.dev/sdk";
import { db } from "../lib/db.ts";
import { chunk, rankStep } from "../lib/pipeline.ts";

/** TypeSafe judgments + rank for qualified people not yet ranked (or all with force). */
export const rankPeople = task({
  id: "rank-people",
  maxDuration: 1800,
  retry: { maxAttempts: 3 },
  run: async (payload: { limit?: number; force?: boolean }) => {
    let q = db.from("people").select("login").eq("qualified", true).order("score", { ascending: false }).limit(payload.limit ?? 5000);
    if (!payload.force) q = q.is("ranked_at", null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    let ranked = 0;
    for (const batch of chunk((data ?? []).map((r) => r.login), 40)) ranked += (await rankStep(batch)).ranked;
    return { ranked };
  },
});

import { Deepline } from "deepline";
import { createHash } from "node:crypto";

// USD per result, from `deepline describe <tool>` on 2026-10-13. Used only when the response carries no billing.
export const PRICE: Record<string, number> = {
  datagma_find_email: 0.014,
  findymail_find_from_business_profile: 0.028,
  peopledatalabs_enrich_contact: 0.2,
  limadata_find_personal_email: 0.14,
};

let ctx: Awaited<ReturnType<typeof Deepline.connect>> | null = null;

export type ToolCall = { ok: boolean; usd: number; values: Record<string, unknown>; raw: unknown; key: string };

/** Stable key per (scope, tool, exact input): same input → Deepline replays the execution for free. */
export const toolKey = (scope: string, tool: string, input: Record<string, unknown>) =>
  `${scope}:${tool}:${createHash("sha1").update(JSON.stringify(input)).digest("hex").slice(0, 12)}`;

/** Execute one Deepline tool. The key is derived from scope + tool + input, so retries and reruns are free. */
export async function callTool(tool: string, input: Record<string, unknown>, scope: string): Promise<ToolCall> {
  // Local `trigger.dev dev` resolves the CLI login automatically; deployed workers need DEEPLINE_API_KEY.
  ctx ??= await Deepline.connect(process.env.DEEPLINE_API_KEY ? { apiKey: process.env.DEEPLINE_API_KEY } : undefined);
  const key = toolKey(scope, tool, input);
  const r = await ctx.tools.execute(tool, input, { idempotencyKey: key });
  const values: Record<string, unknown> = {};
  for (const [k, acc] of Object.entries(r.extractedValues ?? {})) {
    try { values[k] = (acc as any).get?.() ?? null; } catch { values[k] = null; }
  }
  const hasResult = Object.values(values).some((v) => v != null && v !== "");
  const usd = r.billing?.cost_usd ?? (hasResult ? PRICE[tool] ?? 0 : 0);
  return { ok: hasResult, usd, values, raw: r.toolResponse?.rawV2 ?? r.toolResponse?.raw, key };
}

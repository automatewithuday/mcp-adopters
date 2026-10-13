// Deepline implementation of EnrichProvider. Tool ids and prices from `deepline describe <tool>` (2026-10-13).
import { Deepline } from "deepline";
import { createHash } from "node:crypto";
import type { EnrichProvider, Hit, Found } from "./types.ts";

const PRICE: Record<string, number> = {
  datagma_find_email: 0.014,
  findymail_find_from_business_profile: 0.028,
  peopledatalabs_enrich_contact: 0.2,
};

let ctx: Awaited<ReturnType<typeof Deepline.connect>> | null = null;

/** Stable key per (scope, tool, exact input): Deepline replays an identical call for free. */
const toolKey = (scope: string, tool: string, input: Record<string, unknown>) =>
  `${scope}:${tool}:${createHash("sha1").update(JSON.stringify(input)).digest("hex").slice(0, 12)}`;

async function call(tool: string, input: Record<string, unknown>, scope: string): Promise<Hit> {
  // Local runs resolve the CLI login (`deepline auth register`); deployed workers need DEEPLINE_API_KEY.
  ctx ??= await Deepline.connect(process.env.DEEPLINE_API_KEY ? { apiKey: process.env.DEEPLINE_API_KEY } : undefined);
  const key = toolKey(scope, tool, input);
  const r = await ctx.tools.execute(tool, input, { idempotencyKey: key });
  const values: Found = {};
  for (const [k, acc] of Object.entries(r.extractedValues ?? {})) {
    try { (values as any)[k] = (acc as any).get?.() ?? null; } catch { (values as any)[k] = null; }
  }
  const ok = Object.values(values).some((v) => v != null && v !== "");
  const usd = r.billing?.cost_usd ?? (ok ? PRICE[tool] ?? 0 : 0);
  return { ok, usd, tool, key, values };
}

export const deepline: EnrichProvider = {
  emailFromNameDomain: (p, scope) => call("datagma_find_email", { first_name: p.first_name, last_name: p.last_name, domain: p.domain }, scope),
  emailFromLinkedin: (p, scope) => call("findymail_find_from_business_profile", { linkedin_url: p.linkedin }, scope),
  enrichPerson: (p, scope) => call("peopledatalabs_enrich_contact", p.email ? { email: p.email } : { profile: p.profile }, scope),
};

// Deepline implementation of EnrichProvider. Tool ids and prices from `deepline describe <tool>` (2026-10-14).
import { Deepline } from "deepline";
import { createHash } from "node:crypto";
import type { EnrichProvider, Hit, Found, Firmographics, Activity } from "./types.ts";

const PRICE: Record<string, number> = {
  datagma_find_email: 0.014,
  findymail_find_from_business_profile: 0.028,
  peopledatalabs_enrich_contact: 0.2,
  harvestapi_get_company: 0.003,
  harvestapi_get_profile_posts: 0.003,
  harvestapi_get_profile_comments: 0.003,
  harvestapi_get_profile_reactions: 0.003,
};

let ctx: Awaited<ReturnType<typeof Deepline.connect>> | null = null;

/** Stable key per (scope, tool, exact input): Deepline replays an identical call for free. */
const toolKey = (scope: string, tool: string, input: Record<string, unknown>) =>
  `${scope}:${tool}:${createHash("sha1").update(JSON.stringify(input)).digest("hex").slice(0, 12)}`;

/** One tool execution. `raw` is the provider payload (toolResponse.rawV2) for fields Deepline doesn't extract. */
async function exec(tool: string, input: Record<string, unknown>, scope: string) {
  // Local runs resolve the CLI login (`deepline auth register`); deployed workers need DEEPLINE_API_KEY.
  ctx ??= await Deepline.connect(process.env.DEEPLINE_API_KEY ? { apiKey: process.env.DEEPLINE_API_KEY } : undefined);
  const key = toolKey(scope, tool, input);
  const r = await ctx.tools.execute(tool, input, { idempotencyKey: key });
  const raw = ((r as any).toolResponse?.rawV2 ?? {}) as any;
  const usd = (ok: boolean) => r.billing?.cost_usd ?? (ok ? PRICE[tool] ?? 0 : 0);
  return { r, key, raw, usd };
}

async function call(tool: string, input: Record<string, unknown>, scope: string): Promise<Hit> {
  const { r, key, usd } = await exec(tool, input, scope);
  const values: Found = {};
  for (const [k, acc] of Object.entries(r.extractedValues ?? {})) {
    try { (values as any)[k] = (acc as any).get?.() ?? null; } catch { (values as any)[k] = null; }
  }
  const ok = Object.values(values).some((v) => v != null && v !== "");
  return { ok, usd: usd(ok), tool, key, values };
}

/** HarvestAPI dates arrive as ISO strings, {date|timestamp} objects, or epoch ms. Returns ISO or null. */
function isoDate(v: unknown): string | null {
  const x = typeof v === "object" && v ? (v as any).date ?? (v as any).timestamp : v;
  if (x == null) return null;
  const d = new Date(typeof x === "number" && x < 1e12 ? x * 1000 : (x as any));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const deepline: EnrichProvider = {
  emailFromNameDomain: (p, scope) => call("datagma_find_email", { first_name: p.first_name, last_name: p.last_name, domain: p.domain }, scope),
  emailFromLinkedin: (p, scope) => call("findymail_find_from_business_profile", { linkedin_url: p.linkedin }, scope),
  enrichPerson: (p, scope) => call("peopledatalabs_enrich_contact", p.email ? { email: p.email } : { profile: p.profile }, scope),

  // LinkedIn company page by name search ($0.003). Search can return the wrong company: the caller verifies name/domain.
  companyFirmographics: async (p, scope) => {
    const tool = "harvestapi_get_company";
    const search = (p.name ?? p.domain ?? "").trim();
    // HarvestAPI 422s on an empty search; don't spend a call on it
    if (!search) return { ok: false, usd: 0, tool, key: `${scope}:${tool}:empty`, values: {} };
    const { key, raw, usd } = await exec(tool, { search }, scope);
    const el = raw.element ?? {};
    const locs: any[] = Array.isArray(el.locations) ? el.locations : [];
    const hq = locs.find((l) => l?.headquarter) ?? locs[0];
    const cc = hq?.countryCode ?? hq?.parsed?.countryCode ?? hq?.country ?? null;
    const values: Firmographics = {
      name: el.name ?? null,
      domain: el.website ?? null,
      linkedin: el.universalName ? `https://www.linkedin.com/company/${el.universalName}` : null,
      employees: el.employeeCount ?? null,
      employees_min: el.employeeCountRange?.start ?? null,
      employees_max: el.employeeCountRange?.end ?? null,
      hq_country: typeof cc === "string" && cc.length === 2 ? cc.toUpperCase() : null,
      industry: (() => { const i = el.industries?.[0] ?? el.industry; return typeof i === "string" ? i : i?.name ?? null; })(),
    };
    const ok = !!values.name;
    return { ok, usd: usd(ok), tool, key, values };
  },

  // Three page-1 reads ($0.003 each). One ledger row keyed on the posts call; Deepline replays each sub-call free.
  linkedinActivity: async (p, scope) => {
    const posts = await exec("harvestapi_get_profile_posts", { profile: p.linkedin, scrapePostedLimit: "3months" }, scope);
    const comments = await exec("harvestapi_get_profile_comments", { profile: p.linkedin }, scope);
    const reactions = await exec("harvestapi_get_profile_reactions", { profile: p.linkedin }, scope);
    const els = (x: { raw: any }) => (Array.isArray(x.raw.elements) ? x.raw.elements : []) as any[];
    const errored = (x: { raw: any }) => x.raw.error != null || (typeof x.raw.status === "number" && x.raw.status >= 400);
    const values: Activity = {
      post_dates: els(posts).map((e) => isoDate(e.postedAt)).filter((d): d is string => !!d),
      comment_dates: els(comments).map((e) => isoDate(e.createdAtTimestamp ?? e.createdAt)).filter((d): d is string => !!d),
      reactions: els(reactions).length,
    };
    const ok = ![posts, comments, reactions].every(errored);
    const usd = Math.round((posts.usd(true) + comments.usd(true) + reactions.usd(true)) * 1e6) / 1e6;
    return { ok, usd, tool: "harvestapi_activity", key: posts.key, values };
  },
};

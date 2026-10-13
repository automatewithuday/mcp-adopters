// Plain functions shared by the Trigger.dev tasks and scripts/run.ts. No Trigger imports here.
import { db } from "./db.ts";
import { actorsFor } from "./clickhouse.ts";
import { profiles, orgDomain, domainOf } from "./github.ts";
import { qualify, isFreemail, emailInText, websiteMatchesCompany, HOSTING_DOMAIN, isMaintainer } from "./qualify.ts";
import { provider, type Hit, type Found } from "./providers/index.ts";
import { judge, compose, explain, type PersonState } from "./rank.ts";

export const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** ClickHouse → people (login, repos, signals, last_seen). Returns the logins. */
export async function fetchActorsStep(repos: string[], days: number): Promise<string[]> {
  const actors = await actorsFor(repos, days);
  for (const rows of chunk(actors, 1000)) {
    const { error } = await db.from("people").upsert(rows, { onConflict: "login" });
    if (error) throw new Error(`people upsert: ${error.message}`);
  }
  return actors.map((a) => a.login);
}

/** GitHub GraphQL for ≤100 logins → qualify → people. */
export async function fetchProfilesStep(logins: string[]) {
  const ps = await profiles(logins);
  const { data: existing, error } = await db.from("people").select("login,repos,signals").in("login", logins);
  if (error) throw new Error(`people select: ${error.message}`);
  const byLogin = new Map((existing ?? []).map((r) => [r.login, r]));
  const rows = [];
  for (const p of ps) {
    const prev = byLogin.get(p.login) ?? { repos: [], signals: [] };
    // free email hiding in the bio ("Email: x@y.com") counts the same as the profile field
    p.github_email ??= emailInText(p.bio);
    const company_norm = (p.company ?? "").replace(/^@/, "").trim() || null;
    let company_domain: string | null = null;
    if (p.company?.startsWith("@")) company_domain = await orgDomain(p.company.slice(1).trim().split(/\s/)[0]);
    if (!company_domain && p.github_email && !isFreemail(p.github_email)) {
      // an email domain stands in for the company only when it echoes the company name or no company is given
      const ed = domainOf(p.github_email);
      if (ed && (!company_norm || websiteMatchesCompany(ed, company_norm))) company_domain = ed;
    }
    const site = domainOf(p.website);
    if (!company_domain && site && !HOSTING_DOMAIN.test(site) && websiteMatchesCompany(site, company_norm)) company_domain = site;
    const q = qualify({ ...p, repos: prev.repos, signals: prev.signals, company_domain });
    const maintainer = isMaintainer({ company: p.company, bio: p.bio, repos: prev.repos, signals: prev.signals });
    rows.push({ ...p, ...q, company_domain, maintainer, fetched_at: new Date().toISOString() });
  }
  if (rows.length) {
    const { error: e2 } = await db.from("people").upsert(rows, { onConflict: "login" });
    if (e2) throw new Error(`people upsert: ${e2.message}`);
  }
  return { requested: logins.length, resolved: rows.length, qualified: rows.filter((r) => r.qualified).length };
}

/** TypeSafe judgments + composite rank + reasoning line for a set of logins. ~800 input tokens/person. */
export async function rankStep(logins: string[], concurrency = 8) {
  const { data, error } = await db.from("people").select("login,name,company,bio,website,location,followers,repos,signals").in("login", logins);
  if (error) throw new Error(`people select: ${error.message}`);
  const people = (data ?? []) as PersonState[];
  const rows: Record<string, unknown>[] = [];
  for (const batch of chunk(people, concurrency)) {
    const judged = await Promise.all(batch.map(async (p) => ({ p, j: await judge(p) })));
    for (const { p, j } of judged) {
      rows.push({
        login: p.login, rank: compose(j, p), reasoning: explain(j, p),
        persona: j.persona, persona_p: j.persona_p, adoption: j.adoption, security_influence: j.security,
        real_company: j.real_company, enterprise: j.enterprise,
        judge_confidence: Math.min(j.adoption_conf, j.security_conf, j.persona_p), ranked_at: new Date().toISOString(),
      });
    }
  }
  if (rows.length) {
    const { error: e2 } = await db.from("people").upsert(rows, { onConflict: "login" });
    if (e2) throw new Error(`people upsert: ${e2.message}`);
  }
  return { ranked: rows.length };
}

/** Qualified, ranked, non-maintainer people with no contacts row, best rank first. Only these get paid enrichment. */
export async function enrichCandidates(minRank: number, limit: number): Promise<string[]> {
  const { data, error } = await db
    .from("people_to_enrich").select("login").gte("rank", minRank).or("maintainer.is.null,maintainer.eq.false")
    .order("rank", { ascending: false }).order("score", { ascending: false }).limit(limit);
  if (error) throw new Error(`people_to_enrich: ${error.message}`);
  return (data ?? []).map((r) => r.login);
}

type Person = { login: string; name: string | null; company_norm: string | null; company_domain: string | null; linkedin: string | null; github_email: string | null };

/**
 * Email waterfall, cheapest first. Caller guarantees one at a time per runId (spend-cap check is read-then-write).
 * `sleep` is injected: Trigger uses wait.for, the local runner uses setTimeout.
 */
export async function enrichPersonStep(
  { login, runId, maxUsd }: { login: string; runId: string; maxUsd: number },
  sleep: (seconds: number) => Promise<void>,
) {
  const { data: p, error } = await db.from("people").select("login,name,company_norm,company_domain,linkedin,github_email").eq("login", login).single<Person>();
  if (error || !p) throw new Error(`people ${login}: ${error?.message}`);

  const tools: string[] = [];
  const found: Found = { linkedin: p.linkedin, company: p.company_norm, company_domain: p.company_domain };
  let emailSource = "none";
  const [first_name, ...rest] = (p.name ?? "").trim().split(/\s+/);
  found.first_name = first_name || null;
  found.last_name = rest.join(" ") || null;

  const overCap = async () => {
    const { data, error } = await db.rpc("run_spend", { rid: runId });
    if (error) throw new Error(`run_spend: ${error.message}`);
    return Number(data) >= maxUsd;
  };
  const paid = async (fn: (scope: string) => Promise<Hit>) => {
    if (await overCap()) return null;
    const r = await fn(`${runId}:${login}`);
    tools.push(r.tool);
    // keyed on the provider's idempotency key: a replayed call never adds a second ledger row
    if (r.usd > 0) await db.from("spend").upsert({ run_id: runId, login, tool: r.tool, usd: r.usd, key: r.key }, { onConflict: "key", ignoreDuplicates: true });
    return r.ok ? r.values : null;
  };
  const setEmail = (email: unknown, source: string) => {
    if (typeof email === "string" && email.includes("@") && !found.email) { found.email = email; emailSource = source; }
  };

  // 1. free: GitHub public email on a corporate domain
  if (p.github_email && !isFreemail(p.github_email)) setEmail(p.github_email, "github_profile");

  // 2+3. cheap finders (run again after person enrichment if it adds a domain/linkedin)
  const cheap = async () => {
    if (!found.email && found.first_name && found.last_name && found.company_domain) {
      const v = await paid((scope) => provider.emailFromNameDomain({ first_name: found.first_name!, last_name: found.last_name!, domain: found.company_domain! }, scope));
      setEmail(v?.email, "name_domain");
    }
    if (!found.email && found.linkedin) {
      const v = await paid((scope) => provider.emailFromLinkedin({ linkedin: found.linkedin! }, scope));
      setEmail(v?.email, "linkedin");
      found.company_domain ??= v?.company_domain ?? null;
    }
  };
  await cheap();

  // 4. person enrichment keyed on the GitHub email (any domain) or the GitHub profile URL; also gives title/company/linkedin
  if (!found.email || !found.title) {
    const key = p.github_email ? { email: p.github_email } : { profile: `https://github.com/${login}` };
    const v = await paid((scope) => provider.enrichPerson(key, scope));
    if (v) {
      found.title ??= v.title ?? null;
      found.company = v.company || found.company;
      found.company_domain = domainOf(v.company_domain) || found.company_domain;
      found.linkedin ??= v.linkedin ?? null;
      found.first_name = v.first_name || found.first_name;
      found.last_name = v.last_name || found.last_name;
      setEmail(v.email, "person_enrich");
      await sleep(6);
      await cheap();
    }
  }

  // 5. freemail GitHub email: kept, flagged
  if (!found.email && p.github_email) setEmail(p.github_email, "github_profile_personal");
  if (emailSource === "none" && tools.length === 0 && maxUsd > 0 && (await overCap())) emailSource = "skipped_cap";

  // a "verified" email at a different domain than the company usually means an old employer or a side project
  const emailDomain = domainOf(found.email ?? null);
  const email_domain_match = found.email && found.company_domain ? emailDomain === found.company_domain : null;
  const row = {
    login, email: found.email ?? null, email_source: emailSource, email_domain_match,
    first_name: found.first_name, last_name: found.last_name, title: found.title ?? null,
    company: found.company ?? null, company_domain: found.company_domain ?? null, linkedin: found.linkedin ?? null,
    tools_used: tools, enriched_at: new Date().toISOString(),
  };
  const { error: e2 } = await db.from("contacts").upsert(row, { onConflict: "login" });
  if (e2) throw new Error(`contacts upsert: ${e2.message}`);
  return { login, email_source: emailSource, tools };
}

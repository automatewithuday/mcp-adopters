// Plain functions shared by the Trigger.dev tasks and scripts/run.ts. No Trigger imports here.
import { db, all } from "./db.ts";
import { actorsFor, buildersFor } from "./clickhouse.ts";
import { profiles, orgDomain, domainOf } from "./github.ts";
import { qualify, isFreemail, emailInText, websiteMatchesCompany, HOSTING_DOMAIN, isMaintainer } from "./qualify.ts";
import { provider, type Hit, type Found, type Firmographics } from "./providers/index.ts";
import { judge, compose, explain, type PersonState } from "./rank.ts";
import { companyKey, verifiedCompany, icpFit, type Icp } from "./icp.ts";
import { scoreActivity } from "./activity.ts";

export const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** ClickHouse → people (login, repos, signals, last_seen), merged with what earlier fetches stored. Returns the logins. */
export async function fetchActorsStep(repos: string[], days: number, source: "repos" | "builders" = "repos"): Promise<string[]> {
  const actors = source === "builders" ? await buildersFor(days) : await actorsFor(repos, days);
  for (const rows of chunk(actors, 300)) {
    // a person can come from both sources: union repos/signals instead of letting the later fetch overwrite
    const { data: prev, error: e1 } = await db.from("people").select("login,repos,signals").in("login", rows.map((r) => r.login));
    if (e1) throw new Error(`people select: ${e1.message}`);
    const byLogin = new Map((prev ?? []).map((r) => [r.login, r]));
    const merged = rows.map((r) => {
      const p = byLogin.get(r.login);
      return p ? { ...r, repos: [...new Set([...p.repos, ...r.repos])], signals: [...new Set([...p.signals, ...r.signals])] } : r;
    });
    const { error } = await db.from("people").upsert(merged, { onConflict: "login" });
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
    rows.push({ ...p, ...q, company_domain, company_key: companyKey(q.company_norm, company_domain), maintainer, fetched_at: new Date().toISOString() });
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
    // ponytail: provider 5xx/499 are transient; two retries, then skip the person (ranked_at stays null, the next run picks them up)
    const judged = await Promise.all(batch.map(async (p) => {
      for (let attempt = 0; ; attempt++) {
        try { return { p, j: await judge(p) }; }
        catch (e) {
          if (attempt >= 2) { console.error(`rank skip ${p.login}: ${(e as Error).message.slice(0, 120)}`); return null; }
          await new Promise((r) => setTimeout(r, 2000 * 4 ** attempt));
        }
      }
    }));
    for (const { p, j } of judged.filter((x) => x !== null)) {
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

/**
 * Spend cap + ledger for one run. `paid` skips the call when the run is at the cap, records cost on the
 * provider's idempotency key (a replay never adds a second row), and returns the values on a hit.
 * Caller guarantees one `paid` at a time per runId (the cap check is read-then-write). `subject` is a login or a company key.
 */
function ledger(runId: string, subject: string, maxUsd: number) {
  const tools: string[] = [];
  const overCap = async () => {
    const { data, error } = await db.rpc("run_spend", { rid: runId });
    if (error) throw new Error(`run_spend: ${error.message}`);
    return Number(data) >= maxUsd;
  };
  const paid = async <T>(fn: (scope: string) => Promise<Hit<T>>): Promise<T | null> => {
    if (await overCap()) return null;
    const r = await fn(`${runId}:${subject}`);
    tools.push(r.tool);
    if (r.usd > 0) await db.from("spend").upsert({ run_id: runId, login: subject, tool: r.tool, usd: r.usd, key: r.key }, { onConflict: "key", ignoreDuplicates: true });
    return r.ok ? r.values : null;
  };
  /** true when nothing ran because the cap was already reached */
  const skippedForCap = async () => tools.length === 0 && maxUsd > 0 && (await overCap());
  return { tools, overCap, paid, skippedForCap };
}

/**
 * Qualified, ranked, non-maintainer people with no contacts row, best rank first. Only these get paid enrichment.
 * `requireIcp` (set when an ICP file is given) narrows to people whose company passed the ICP gate.
 */
export async function enrichCandidates(minRank: number, limit: number, requireIcp = false): Promise<string[]> {
  let q = db
    .from("people_to_enrich").select("login").gte("rank", minRank).or("maintainer.is.null,maintainer.eq.false");
  if (requireIcp) q = q.eq("icp_fit", true);
  const { data, error } = await q.order("rank", { ascending: false }).order("score", { ascending: false }).limit(limit);
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

  const { tools, paid, skippedForCap } = ledger(runId, login, maxUsd);
  const found: Found = { linkedin: p.linkedin, company: p.company_norm, company_domain: p.company_domain };
  let emailSource = "none";
  const [first_name, ...rest] = (p.name ?? "").trim().split(/\s+/);
  found.first_name = first_name || null;
  found.last_name = rest.join(" ") || null;

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
  if (emailSource === "none" && (await skippedForCap())) emailSource = "skipped_cap";

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

// ---- ICP gate (company level) --------------------------------------------------------------------

export type CompanyRef = { key: string; name: string | null; domain: string | null };

/**
 * Companies behind qualified, non-maintainer people ranked ≥ minRank that have no verdict yet (all of them with `force`).
 * Unranked people don't count: run `rank` first. The rank gate keeps the paid lookup off the long tail.
 * Domain-less companies are skipped: 0 fits in 774 name-only checks (2026-10-14), they are unresolvable by name.
 */
export async function icpCandidates(force = false, minRank = 0): Promise<CompanyRef[]> {
  const data = await all((a, b) => db.from("people").select("company_key,company_norm,company_domain")
    .eq("qualified", true).or("maintainer.is.null,maintainer.eq.false").not("company_key", "is", null).not("company_domain", "is", null)
    .gte("rank", minRank).order("login").range(a, b));
  const byKey = new Map<string, CompanyRef>();
  for (const r of data) {
    const c = byKey.get(r.company_key) ?? { key: r.company_key, name: null, domain: null };
    c.name ??= r.company_norm; c.domain ??= r.company_domain;
    byKey.set(r.company_key, c);
  }
  if (!force) {
    // a provider error (credits, 5xx) is not a verdict: those companies are checked again next run
    const done = await all((a, b) => db.from("companies").select("key").not("checked_at", "is", null).not("icp_reason", "like", "error:%").order("key").range(a, b));
    for (const r of done) byKey.delete(r.key);
  }
  return [...byKey.values()];
}

/** Companies already checked by name that stayed unknown and have a domain: the domain fallback's queue. */
export async function icpUnknowns(): Promise<CompanyRef[]> {
  const rows = await all((a, b) => db.from("companies").select("key,name,domain").is("icp_fit", null).not("domain", "is", null)
    .not("checked_at", "is", null).not("icp_reason", "like", "error:%").not("icp_reason", "like", "%via domain%").order("key").range(a, b));
  return rows as CompanyRef[];
}

/**
 * One company: name search → verify it's the right company; if that fails and we have a domain, domain → company
 * LinkedIn URL → exact page (accepted as-is: the URL came from our own domain). Then ICP verdict → companies row,
 * then people.icp_fit for everyone at that company. A verified LinkedIn website also fills missing company_domain.
 * Unknown stays null (held, not dropped). Nothing is written when the run is already at the cap.
 * `fallbackOnly` skips the name search for companies it already failed on.
 */
export async function icpStep({ key, name, domain, runId, maxUsd, icp, fallbackOnly = false }: CompanyRef & { runId: string; maxUsd: number; icp: Icp; fallbackOnly?: boolean }) {
  const L = ledger(runId, key, maxUsd);
  let failure: string | null = null;
  const lookup = async <T>(fn: (scope: string) => Promise<Hit<T>>): Promise<T | null> => {
    try { return await L.paid(fn); }
    catch (e) {
      // one bad lookup (e.g. provider 422 on odd search text) must not abort the batch; recorded, re-tried next run
      failure = `error: ${(e as Error).message}`.slice(0, 200);
      return null;
    }
  };
  const norm = (f: Firmographics) => ({ ...f, domain: domainOf(f.domain) });

  let got: Firmographics | null = null, verified = false, via = "";
  if (!fallbackOnly) {
    const v = await lookup((scope) => provider.companyFirmographics({ name, domain }, scope));
    if (v) { got = norm(v); verified = verifiedCompany(got, { name, domain }); }
  }
  if (!verified && domain && !failure) {
    const li = await lookup((scope) => provider.companyLinkedin({ domain }, scope));
    if (li?.linkedin) {
      const v = await lookup((scope) => provider.companyFirmographics({ name, domain, linkedin: li.linkedin }, scope));
      if (v) { got = norm(v); verified = true; via = " (via domain)"; }
    }
  }
  if (!got && !failure && (await L.skippedForCap())) return { key, fit: null as boolean | null, reason: "skipped_cap" };

  let fit: boolean | null = null, reason = failure ?? `not found${domain ? " (via domain)" : ""}`;
  let row: Record<string, unknown> = { key, name, domain, icp_fit: null, icp_reason: reason, source: L.tools.join(">") || null, checked_at: new Date().toISOString() };
  if (got) {
    ({ fit, reason } = verified ? icpFit(got, icp) : { fit: null, reason: `company mismatch: got "${got.name ?? ""}" ${got.domain ?? ""}` });
    reason += via;
    // keep our own name/domain on a mismatch; the returned company is in icp_reason
    row = { ...row, name: verified ? got.name ?? name : name, domain: domain ?? (verified ? got.domain : null), linkedin: verified ? got.linkedin : null,
      employees: got.employees, employees_min: got.employees_min, employees_max: got.employees_max,
      hq_country: got.hq_country, industry: got.industry, icp_fit: fit, icp_reason: reason };
    if (verified && !domain && got.domain) {
      const { error } = await db.from("people").update({ company_domain: got.domain }).eq("company_key", key).is("company_domain", null);
      if (error) throw new Error(`people domain fill: ${error.message}`);
    }
  }
  const { error } = await db.from("companies").upsert(row, { onConflict: "key" });
  if (error) throw new Error(`companies upsert: ${error.message}`);
  const { error: e2 } = await db.from("people").update({ icp_fit: fit }).eq("company_key", key);
  if (e2) throw new Error(`people icp_fit: ${e2.message}`);
  return { key, fit, reason };
}

// ---- LinkedIn activity (before LinkedIn outreach) ---------------------------------------------------

/** linkedin-channel people (profile URL + company domain, no email) not yet checked, best rank first. */
export async function activityCandidates(minRank: number, limit: number, requireIcp = false): Promise<{ login: string; linkedin: string }[]> {
  let q = db.from("outreach_queue").select("login,linkedin").eq("channel", "linkedin").gte("rank", minRank).is("activity_status", null);
  if (requireIcp) q = q.eq("icp_fit", true);
  const { data, error } = await q.order("rank", { ascending: false }).limit(limit);
  if (error) throw new Error(`outreach_queue: ${error.message}`);
  return (data ?? []) as { login: string; linkedin: string }[];
}

/** Posts/comments/reactions → score → linkedin_activity row. Skipped (no row) when the run is at the cap. */
export async function activityStep({ login, linkedin, runId, maxUsd }: { login: string; linkedin: string; runId: string; maxUsd: number }) {
  const L = ledger(runId, login, maxUsd);
  const v = await L.paid((scope) => provider.linkedinActivity({ linkedin }, scope));
  if (!v) {
    if (await L.skippedForCap()) return { login, activity_status: "skipped_cap", outreach_ready: false };
    const { error } = await db.from("linkedin_activity").upsert({ login, linkedin, activity_status: "inactive", activity_level: "minimal", outreach_ready: false, reason: "profile not readable", checked_at: new Date().toISOString() }, { onConflict: "login" });
    if (error) throw new Error(`linkedin_activity upsert: ${error.message}`);
    return { login, activity_status: "inactive", outreach_ready: false };
  }
  const s = scoreActivity(v);
  const { error } = await db.from("linkedin_activity").upsert({ login, linkedin, ...s, checked_at: new Date().toISOString() }, { onConflict: "login" });
  if (error) throw new Error(`linkedin_activity upsert: ${error.message}`);
  return { login, activity_status: s.activity_status, outreach_ready: s.outreach_ready };
}

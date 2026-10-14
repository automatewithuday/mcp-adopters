/**
 * Enrichment provider contract. The pipeline only knows these lookups.
 * Ship your own in this folder and select it with ENRICH_PROVIDER (see index.ts).
 */
export type Found = {
  email?: string | null;
  title?: string | null;
  company?: string | null;
  company_domain?: string | null;
  linkedin?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

/** Company facts used by the ICP gate. `domain` may be a raw website URL; the pipeline normalises it. */
export type Firmographics = {
  name?: string | null;
  domain?: string | null;
  linkedin?: string | null;
  employees?: number | null;
  employees_min?: number | null;
  employees_max?: number | null;
  hq_country?: string | null; // ISO-2, upper case
  industry?: string | null;
};

/** Raw LinkedIn activity evidence; scoring happens in src/lib/activity.ts. Reactions have no dates. */
export type Activity = {
  post_dates: string[];
  comment_dates: string[];
  reactions: number;
};

export type Hit<T = Found> = {
  /** true when the provider returned at least one useful value */
  ok: boolean;
  /** what this call cost, in USD; 0 for misses, replays, or free providers */
  usd: number;
  /** the tool/endpoint name, recorded in the spend ledger */
  tool: string;
  /** stable id for this exact call; a retry with the same key must not charge again */
  key: string;
  values: T;
};

export interface EnrichProvider {
  /** Work email from a person's name and their company's web domain. Cheapest step. */
  emailFromNameDomain(p: { first_name: string; last_name: string; domain: string }, scope: string): Promise<Hit>;
  /** Work email from a LinkedIn profile URL. */
  emailFromLinkedin(p: { linkedin: string }, scope: string): Promise<Hit>;
  /** Title, company, domain, LinkedIn and email from an email address or a social profile URL (e.g. a GitHub URL). */
  enrichPerson(p: { email?: string; profile?: string }, scope: string): Promise<Hit>;
  /**
   * Headcount and HQ country for a company. With `linkedin` the exact company page is read; otherwise a name/domain
   * search, which the caller verifies (search can land on a namesake).
   */
  companyFirmographics(p: { name: string | null; domain: string | null; linkedin?: string | null }, scope: string): Promise<Hit<Firmographics>>;
  /** Company LinkedIn URL (and name) from a web domain. The fallback when name search fails. */
  companyLinkedin(p: { domain: string }, scope: string): Promise<Hit<Firmographics>>;
  /** Recent posts, comments and reactions for a LinkedIn profile URL. ok=false when the profile can't be read. */
  linkedinActivity(p: { linkedin: string }, scope: string): Promise<Hit<Activity>>;
}

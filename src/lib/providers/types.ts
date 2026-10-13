/**
 * Enrichment provider contract. The pipeline only knows these three lookups.
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

export type Hit = {
  /** true when the provider returned at least one useful value */
  ok: boolean;
  /** what this call cost, in USD; 0 for misses, replays, or free providers */
  usd: number;
  /** the tool/endpoint name, recorded in the spend ledger */
  tool: string;
  /** stable id for this exact call; a retry with the same key must not charge again */
  key: string;
  values: Found;
};

export interface EnrichProvider {
  /** Work email from a person's name and their company's web domain. Cheapest step. */
  emailFromNameDomain(p: { first_name: string; last_name: string; domain: string }, scope: string): Promise<Hit>;
  /** Work email from a LinkedIn profile URL. */
  emailFromLinkedin(p: { linkedin: string }, scope: string): Promise<Hit>;
  /** Title, company, domain, LinkedIn and email from an email address or a social profile URL (e.g. a GitHub URL). */
  enrichPerson(p: { email?: string; profile?: string }, scope: string): Promise<Hit>;
}

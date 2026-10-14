import repos from "../repos.json" with { type: "json" };

/**
 * Owner-approved source list. `run.ts discover` regenerates the candidates from GitHub search (MCP in the repo
 * name, ≥ --min-stars); entries marked `curated` survive a regeneration. Review the diff before fetching.
 */
export const SEED_REPOS: string[] = repos.map((r) => r.repo);

/** Repo owner → company names that count as "works there". Lowercase, alphanumeric only. Owners not listed match their own slug. */
export const OWNER_ALIASES: Record<string, string[]> = {
  modelcontextprotocol: ["anthropic", "anthropics"],
  prefecthq: ["prefect", "prefecthq"],
  googleapis: ["google", "googleapis"],
  "google-labs-code": ["google"],
  chromedevtools: ["google", "chrome"],
  awslabs: ["aws", "amazon", "awslabs", "amazonwebservices"],
  aws: ["aws", "amazon", "amazonwebservices"],
  microsoft: ["microsoft"],
  microsoftdocs: ["microsoft"],
  azure: ["microsoft", "azure"],
  github: ["github", "githubinc"],
  makenotion: ["notion"],
  getsentry: ["sentry"],
  perplexityai: ["perplexity"],
  "exa-labs": ["exa"],
  "tavily-ai": ["tavily"],
  "minimax-ai": ["minimax"],
  "lastmile-ai": ["lastmile"],
  "redhat-et": ["redhat"],
  containers: ["redhat"],
  zilliztech: ["zilliz"],
  "21st-dev": ["21st"],
  matlab: ["mathworks"],
  mark3labs: ["mark3labs"],
  glips: ["glips"],
};

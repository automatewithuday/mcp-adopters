// Candidate MCP repos from the GitHub search API. Free; 30 authenticated search calls/min, 1000 results per query.
export type Candidate = { repo: string; stars: number; desc: string; curated?: boolean };

const QUERIES = ["mcp server in:name,description,topics", "topic:mcp-server", "topic:mcp", "topic:model-context-protocol"];
const MCP = /mcp|model.?context.?protocol/i;
// curated lists and courses: their stargazers are browsing, not adopting
const LIST = /awesome|-zh$|guide|tutorial|beginners|book/i;

/** MCP in the repo name or owner (a topic or a passing mention in the description is not enough), not a list/course, enough stars to matter. */
export function keep(c: Candidate, minStars: number): boolean {
  return c.stars >= minStars && MCP.test(c.repo) && !LIST.test(c.repo);
}

export async function searchRepos(minStars: number, pages = 2): Promise<Candidate[]> {
  const seen = new Map<string, Candidate>();
  for (const q of QUERIES) {
    for (let page = 1; page <= pages; page++) {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "User-Agent": "mcp-prospecting" } });
      if (!res.ok) throw new Error(`github search ${res.status}: ${await res.text()}`);
      const { items } = (await res.json()) as { items: any[] };
      for (const r of items) seen.set(r.full_name, { repo: r.full_name, stars: r.stargazers_count, desc: (r.description ?? "").slice(0, 100) });
      if (items.length < 100) break;
    }
  }
  return [...seen.values()].filter((c) => keep(c, minStars)).sort((a, b) => b.stars - a.stars);
}

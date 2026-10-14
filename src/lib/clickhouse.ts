// Public GH Archive mirror. Free, no auth. ponytail: play.clickhouse.com has a 60s query cap; 232 repos × 365 days ran in <1s.
const URL = "https://play.clickhouse.com/?user=play";
const EVENTS = ["WatchEvent", "ForkEvent", "IssuesEvent", "PullRequestEvent"];
/** Builder signals: only ever produced by `buildersFor`, so a person carrying one touched an MCP-named repo as a committer. */
export const BUILD_EVENTS = ["PushEvent", "CreateEvent", "ReleaseEvent"];

export type Actor = { login: string; repos: string[]; signals: string[]; last_seen: string };

const q = (s: string) => `'${s.replace(/'/g, "")}'`;

async function run(sql: string): Promise<Actor[]> {
  const res = await fetch(URL, { method: "POST", body: sql });
  if (!res.ok) throw new Error(`clickhouse ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Actor);
}

/** Stargazers, forkers, issue and PR authors of the given repos. */
export async function actorsFor(repos: string[], days: number): Promise<Actor[]> {
  return run(`SELECT actor_login AS login, groupUniqArray(repo_name) AS repos, groupUniqArray(event_type) AS signals,
    toString(max(created_at)) AS last_seen
    FROM github_events
    WHERE event_type IN (${EVENTS.map(q).join(",")}) AND repo_name IN (${repos.map(q).join(",")})
      AND created_at > now() - INTERVAL ${Math.floor(days)} DAY
    GROUP BY actor_login ORDER BY max(created_at) DESC, actor_login FORMAT JSONEachRow`);
}

/**
 * People who pushed to, created or released an MCP-named repo owned by someone else (an org, usually their employer):
 * companies building MCP servers. Own-account repos are left out; hobby projects are the bulk of them.
 */
export async function buildersFor(days: number): Promise<Actor[]> {
  return run(`SELECT actor_login AS login, arraySlice(groupUniqArray(repo_name), 1, 20) AS repos, groupUniqArray(event_type) AS signals,
    toString(max(created_at)) AS last_seen
    FROM github_events
    WHERE event_type IN (${BUILD_EVENTS.map(q).join(",")})
      AND (repo_name ILIKE '%mcp%' OR repo_name ILIKE '%model-context-protocol%')
      AND repo_name NOT ILIKE '%mcpe%'
      AND lower(splitByChar('/', repo_name)[1]) != lower(actor_login) AND actor_login NOT ILIKE '%[bot]%'
      AND created_at > now() - INTERVAL ${Math.floor(days)} DAY
    GROUP BY actor_login ORDER BY max(created_at) DESC, actor_login FORMAT JSONEachRow`);
  // ponytail: '%mcpe%' drops Minecraft Pocket Edition (0.3% of rows); other name collisions are left to qualify/rank
}

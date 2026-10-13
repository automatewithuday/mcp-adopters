// Public GH Archive mirror. Free, no auth. ponytail: play.clickhouse.com has a 60s query cap; the 365-day query ran in ~20s.
const URL = "https://play.clickhouse.com/?user=play";
const EVENTS = ["WatchEvent", "ForkEvent", "IssuesEvent", "PullRequestEvent"];

export type Actor = { login: string; repos: string[]; signals: string[]; last_seen: string };

export async function actorsFor(repos: string[], days: number): Promise<Actor[]> {
  const q = (s: string) => `'${s.replace(/'/g, "")}'`;
  const sql = `SELECT actor_login AS login, groupUniqArray(repo_name) AS repos, groupUniqArray(event_type) AS signals,
    toString(max(created_at)) AS last_seen
    FROM github_events
    WHERE event_type IN (${EVENTS.map(q).join(",")}) AND repo_name IN (${repos.map(q).join(",")})
      AND created_at > now() - INTERVAL ${Math.floor(days)} DAY
    GROUP BY actor_login ORDER BY max(created_at) DESC, actor_login FORMAT JSONEachRow`;
  const res = await fetch(URL, { method: "POST", body: sql });
  if (!res.ok) throw new Error(`clickhouse ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

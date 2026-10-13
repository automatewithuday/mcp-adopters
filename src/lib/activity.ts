// LinkedIn activity → active/stale/inactive + outreach_ready. Owner decision; thresholds live here.
// ponytail: plain rules; swap for a TypeSafe judge (see rank.ts) if parity with the Python activity-intel repo matters.
import type { Activity } from "./providers/types.ts";

export type ActivityScore = {
  posts_30d: number; posts_90d: number; comments_30d: number; comments_90d: number; reactions: number;
  last_activity_at: string | null; days_since_last_activity: number | null;
  activity_status: "active" | "stale" | "inactive";
  activity_level: "minimal" | "low" | "moderate" | "high";
  outreach_ready: boolean; reason: string;
};

const DAY = 86_400_000;

export function scoreActivity(a: Activity, now = new Date()): ActivityScore {
  const ages = (ds: string[]) => ds.map((d) => (now.getTime() - new Date(d).getTime()) / DAY).filter((x) => !Number.isNaN(x) && x >= 0);
  const posts = ages(a.post_dates), comments = ages(a.comment_dates);
  const within = (xs: number[], d: number) => xs.filter((x) => x <= d).length;
  const posts_30d = within(posts, 30), posts_90d = within(posts, 90);
  const comments_30d = within(comments, 30), comments_90d = within(comments, 90);
  const newest = Math.min(...posts, ...comments);
  const days = Number.isFinite(newest) ? Math.floor(newest) : null;
  const activity_status = days == null ? "inactive" : days <= 30 ? "active" : days <= 90 ? "stale" : "inactive";
  const n = posts_90d + comments_90d + a.reactions;
  const activity_level = n === 0 ? "minimal" : n <= 2 ? "low" : n <= 9 ? "moderate" : "high";
  const outreach_ready = activity_status === "active" || (activity_status === "stale" && (activity_level === "moderate" || activity_level === "high"));
  const last = days == null ? "no dated activity" : `last post/comment ${days}d ago`;
  const reason = `${last} · ${posts_90d} posts, ${comments_90d} comments in 90d, ${a.reactions} reactions`;
  return {
    posts_30d, posts_90d, comments_30d, comments_90d, reactions: a.reactions,
    last_activity_at: days == null ? null : new Date(now.getTime() - newest * DAY).toISOString(),
    days_since_last_activity: days, activity_status, activity_level, outreach_ready, reason,
  };
}

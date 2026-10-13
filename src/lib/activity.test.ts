import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreActivity } from "./activity.ts";

const now = new Date("2026-10-14T00:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

test("active: posted within 30 days", () => {
  const s = scoreActivity({ post_dates: [ago(12), ago(40)], comment_dates: [ago(70)], reactions: 4 }, now);
  assert.equal(s.activity_status, "active");
  assert.equal(s.days_since_last_activity, 12);
  assert.equal(s.posts_30d, 1); assert.equal(s.posts_90d, 2); assert.equal(s.comments_90d, 1);
  assert.equal(s.activity_level, "moderate"); // 2 + 1 + 4 = 7
  assert.equal(s.outreach_ready, true);
  assert.match(s.reason, /12d ago · 2 posts, 1 comments in 90d, 4 reactions/);
});

test("stale: ready only with moderate+ volume", () => {
  assert.equal(scoreActivity({ post_dates: [ago(45)], comment_dates: [], reactions: 0 }, now).outreach_ready, false);
  const busy = scoreActivity({ post_dates: [ago(45), ago(60)], comment_dates: [ago(80)], reactions: 1 }, now);
  assert.equal(busy.activity_status, "stale"); assert.equal(busy.activity_level, "moderate"); assert.equal(busy.outreach_ready, true);
});

test("inactive: nothing dated, or everything older than 90 days", () => {
  const none = scoreActivity({ post_dates: [], comment_dates: [], reactions: 3 }, now);
  assert.equal(none.activity_status, "inactive"); assert.equal(none.days_since_last_activity, null); assert.equal(none.outreach_ready, false);
  assert.equal(scoreActivity({ post_dates: [ago(200)], comment_dates: ["not a date"], reactions: 0 }, now).activity_status, "inactive");
});

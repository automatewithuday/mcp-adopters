import { test } from "node:test";
import assert from "node:assert/strict";
import { compose, explain, type Judgments, type PersonState } from "./rank.ts";

const p: PersonState = { login: "x", name: "Jane", company: "@Cloudflare", bio: "Platform lead, agents and MCP", website: null, location: null, followers: 10, repos: ["github/github-mcp-server", "awslabs/mcp"], signals: ["WatchEvent", "ForkEvent"] };
const strong: Judgments = { persona: "eng_leader", persona_p: 0.8, adoption: 2.4, adoption_conf: 0.7, security: 2.1, security_conf: 0.6, real_company: 0.95, enterprise: 0.9 };
const weak: Judgments = { persona: "student_or_hobbyist", persona_p: 0.9, adoption: 0.2, adoption_conf: 0.9, security: 0.1, security_conf: 0.9, real_company: 0.05, enterprise: 0.02 };

test("compose: strong profile ranks far above weak, both within 0-100", () => {
  const s = compose(strong, p), w = compose(weak, { repos: ["a/b"], signals: ["WatchEvent"] });
  assert.ok(s > 80 && s <= 100, `strong=${s}`);
  assert.ok(w >= 0 && w < 15, `weak=${w}`);
});

test("compose: weights are the only thing that matters besides bonus", () => {
  // 0.35*(2.4/3) + 0.30*(2.1/3) + 0.20*0.95 + 0.15*0.8 = 0.28+0.21+0.19+0.12 = 0.80 → 80 + 5 fork + 3 multi-repo
  assert.equal(compose(strong, p), 88);
});

test("explain reads like a rep's note", () => {
  const e = explain(strong, p);
  assert.match(e, /^Eng leader \(80%\) · MCP: building\/running MCP — forked on github-mcp-server, mcp; bio: platform, lead, agents, mcp · owns platform\/infra \(60% conf\) · operating company Cloudflare \(95%\) · known enterprise$/);
  assert.match(explain(weak, { ...p, company: null, signals: ["WatchEvent"], repos: ["a/b"], bio: null }), /Student\/hobbyist \(90%\) · MCP: starred only — starred b · no security influence .* · employer unclear \(95%\)$/);
});

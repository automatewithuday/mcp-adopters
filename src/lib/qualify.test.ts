import { test } from "node:test";
import assert from "node:assert/strict";
import { qualify, normalizeCompany, isFreemail, emailInText, websiteMatchesCompany, type Profile } from "./qualify.ts";

const base: Profile = {
  login: "x", name: "Jane Doe", company: null, bio: null, website: null, linkedin: null,
  github_email: null, followers: 0, repos: ["a/b"], signals: ["WatchEvent"],
};

test("normalizeCompany strips @ and title-cases", () => {
  assert.equal(normalizeCompany("@oracle "), "Oracle");
  assert.equal(normalizeCompany("TATA TCS"), "TATA TCS");
  assert.equal(normalizeCompany(null), null);
});

test("isFreemail", () => {
  assert.equal(isFreemail("a@gmail.com"), true);
  assert.equal(isFreemail("a@oracle.com"), false);
  assert.equal(isFreemail("a@privaterelay.appleid.com"), true);
});

test("emailInText pulls an email out of a bio", () => {
  assert.equal(emailInText("\r\nEmail: duwenxin@google.com"), "duwenxin@google.com");
  assert.equal(emailInText("no email here"), null);
});

test("websiteMatchesCompany", () => {
  assert.equal(websiteMatchesCompany("cinnamon.ai", "Cinnamon"), true);
  assert.equal(websiteMatchesCompany("lexisnexis.com", "LexisNexis"), true);
  assert.equal(websiteMatchesCompany("kanakasabesan.com", "Accenture"), false);
  assert.equal(websiteMatchesCompany("andreas-marschke.name", "Akamai Technologies Inc."), false);
});

test("empty shell is dropped", () => {
  assert.equal(qualify({ ...base, name: null }).qualified, false);
});

test("students and schools are dropped", () => {
  assert.equal(qualify({ ...base, company: "Student", bio: "CS student at MIT" }).qualified, false);
  assert.equal(qualify({ ...base, company: "Universidad de Valparaiso" }).qualified, false);
  assert.equal(qualify({ ...base, company: "BrownUniversity" }).qualified, false);
  assert.equal(qualify({ ...base, company: "江西师范大学" }).qualified, false);
  assert.equal(qualify({ ...base, company: "Acme", company_domain: "brown.edu" }).qualified, false);
  assert.equal(qualify({ ...base, company: "Acme", company_domain: "sjtu.edu.cn" }).qualified, false);
});

test("placeholder companies are dropped", () => {
  assert.equal(qualify({ ...base, company: "Independent" }).qualified, false);
  assert.equal(qualify({ ...base, company: "Freelance" }).qualified, false);
});

test("'personal' in a bio does not drop a real company", () => {
  assert.equal(qualify({ ...base, company: "Akamai", bio: "personal website: x.com" }).qualified, true);
});

test("bot is dropped", () => {
  assert.equal(qualify({ ...base, login: "dependabot[bot]", company: "GitHub" }).qualified, false);
  assert.equal(qualify({ ...base, login: "github-security-bot", company: "GitHub, Inc." }).qualified, false);
  assert.equal(qualify({ ...base, login: "abbott", company: "Acme" }).qualified, true);
});

test("company alone qualifies; freemail email is kept but adds no score", () => {
  const r = qualify({ ...base, company: "@oracle", github_email: "jane@gmail.com" });
  assert.equal(r.qualified, true);
  assert.equal(r.company_norm, "Oracle");
  assert.equal(r.score, 25);
});

test("score adds up and is capped at 100", () => {
  const r = qualify({
    ...base, company: "Acme", bio: "Head of Security", linkedin: "https://linkedin.com/in/j",
    github_email: "j@acme.com", followers: 80, repos: ["a/b", "c/d", "e/f"], signals: ["WatchEvent", "ForkEvent"],
  });
  assert.equal(r.score, 100);
});

test("linkedin only (no company) qualifies", () => {
  assert.equal(qualify({ ...base, linkedin: "https://linkedin.com/in/j" }).qualified, true);
});

import { isMaintainer } from "./qualify.ts";
test("isMaintainer: vendor employees who contributed, not stargazers or outsiders", () => {
  const prs = ["WatchEvent", "PullRequestEvent"];
  assert.equal(isMaintainer({ company: "@PrefectHQ ", bio: null, repos: ["PrefectHQ/fastmcp"], signals: prs }), true);
  assert.equal(isMaintainer({ company: "Anthropics", bio: null, repos: ["modelcontextprotocol/python-sdk"], signals: prs }), true);
  assert.equal(isMaintainer({ company: null, bio: "Senior Software Engineer at GitHub. Building the GitHub MCP Server.", repos: ["github/github-mcp-server"], signals: prs }), true);
  assert.equal(isMaintainer({ company: "Microsoft", bio: null, repos: ["microsoft/playwright-mcp"], signals: ["WatchEvent"] }), false);
  assert.equal(isMaintainer({ company: "Netflix", bio: "I love the GitHub MCP server", repos: ["github/github-mcp-server"], signals: prs }), false);
  assert.equal(isMaintainer({ company: "Google", bio: null, repos: ["googleapis/mcp-toolbox"], signals: ["IssuesEvent"] }), true);
});

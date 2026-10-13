// TypeSafe (Jev) judgments per person + composite rank. Weights and wording live here; change freely.
import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";

// ---- weights (sum to 1) ----------------------------------------------------
export const WEIGHTS = { adoption: 0.35, security: 0.3, real_company: 0.2, persona: 0.15 };
export const PERSONA_WEIGHT: Record<string, number> = {
  security_role: 1, exec_or_founder: 0.9, eng_leader: 0.8, engineer: 0.6, product_or_other: 0.3, student_or_hobbyist: 0, unknown: 0.3,
};
const PERSONA_LABEL: Record<string, string> = {
  security_role: "Security role", exec_or_founder: "Exec/founder", eng_leader: "Eng leader", engineer: "Engineer",
  product_or_other: "Product/other", student_or_hobbyist: "Student/hobbyist", unknown: "Role unknown",
};
const ADOPTION_LABEL = ["starred only", "evaluating MCP", "building/running MCP", "ships MCP in product"];
const SECURITY_LABEL = ["no security influence", "individual developer", "owns platform/infra", "owns security or leads eng"];

// ---- questions ---------------------------------------------------------------
export const QUESTIONS = {
  persona: choice("Based on the GitHub profile in the state, what best describes this person's role?", {
    security_role: "Works in security: AppSec, DevSecOps, CISO, security engineer, pentester, security researcher",
    exec_or_founder: "CTO, CEO, founder, co-founder, VP of engineering, head of engineering",
    eng_leader: "Engineering manager, tech lead, staff or principal engineer, architect",
    engineer: "Software, platform, DevOps, SRE, ML or AI engineer without a leadership title",
    product_or_other: "Product manager, designer, data analyst, marketer, consultant, or another non-engineering role",
    student_or_hobbyist: "Student, learner, hobbyist, or someone coding only for fun",
    unknown: "The profile gives no usable signal about the role",
  }),
  real_company: noul("Does this person currently work at an operating company (a business with employees), rather than a school, themselves, a one-person consultancy, or nowhere stated?", {
    true: "An identifiable employer: a company, startup, agency, or enterprise",
    false: "A university, personal brand, freelance, open-source-only, or no employer at all",
  }),
  mcp_adoption: score("How far has this person gone with the Model Context Protocol (MCP), judging from their GitHub activity on MCP repositories and their profile?", [
    "Only starred an MCP repository; nothing else suggests they use it",
    "Evaluating: starred MCP repos and the bio mentions AI, agents, LLMs, or automation, but no sign of running it",
    "Building or running MCP: forked an MCP repo, opened an issue or pull request, or the bio says they build agents, tools, or MCP servers",
    "Ships MCP as part of their product, platform, or company offering, or maintains an MCP server or SDK",
  ]),
  security_influence: score("How much influence would this person have over security or platform decisions at their employer?", [
    "None: not in an engineering or technical decision role, or no employer",
    "Individual developer: writes code but does not own platform, infrastructure, or security choices",
    "Owns platform, infrastructure, DevOps, SRE, or developer tooling decisions for a team",
    "Owns security (AppSec, CISO, security engineering) or leads engineering at the org level",
  ]),
  known_enterprise: noul("Is the company in the state a well-known large enterprise or major tech company (for example Google, Microsoft, IBM, Cisco, Accenture, a Fortune 1000 firm)?"),
};

export type PersonState = {
  login: string; name: string | null; company: string | null; bio: string | null; website: string | null;
  location: string | null; followers: number; repos: string[]; signals: string[];
};
export type Judgments = {
  persona: string; persona_p: number; adoption: number; adoption_conf: number; security: number; security_conf: number;
  real_company: number; enterprise: number;
};

const SIGNAL_WORDS: Record<string, string> = { WatchEvent: "starred", ForkEvent: "forked", IssuesEvent: "opened an issue on", PullRequestEvent: "sent a pull request to" };

export function stateFor(p: PersonState) {
  return {
    name: p.name, company: p.company, bio: p.bio, website: p.website, location: p.location, followers: p.followers,
    mcp_activity: p.signals.map((s) => `${SIGNAL_WORDS[s] ?? s} ${p.repos.join(", ")}`),
  };
}

let client: TypeSafeClient | null = null;
export async function judge(p: PersonState): Promise<Judgments> {
  client ??= new TypeSafeClient({ defaultModel: "jev-1.13.0" }); // pinned: alias may move
  const { answers } = await client.systemOne({ state: stateFor(p), questions: QUESTIONS });
  return {
    persona: answers.persona.choice, persona_p: answers.persona.probabilities[answers.persona.choice],
    adoption: answers.mcp_adoption.score, adoption_conf: answers.mcp_adoption.confidence,
    security: answers.security_influence.score, security_conf: answers.security_influence.confidence,
    real_company: answers.real_company.noul, enterprise: answers.known_enterprise.noul,
  };
}

/** 0-100 composite. Pure: change WEIGHTS and re-run without new inference. */
export function compose(j: Judgments, p: Pick<PersonState, "repos" | "signals">): number {
  const base =
    WEIGHTS.adoption * (j.adoption / 3) +
    WEIGHTS.security * (j.security / 3) +
    WEIGHTS.real_company * j.real_company +
    WEIGHTS.persona * (PERSONA_WEIGHT[j.persona] ?? 0.3);
  let bonus = 0;
  if (p.signals.some((s) => s !== "WatchEvent")) bonus += 5;
  if (p.repos.length > 1) bonus += 3;
  return Math.min(100, Math.round(100 * base + bonus));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const short = (repo: string) => repo.split("/")[1] ?? repo;

/** One line an outreach rep can read next to the rank. Built from the judgments, not model text. */
export function explain(j: Judgments, p: PersonState): string {
  const ACT: Record<string, string> = { ForkEvent: "forked", IssuesEvent: "issue", PullRequestEvent: "PR" };
  const acts = p.signals.filter((s) => s in ACT).map((s) => ACT[s]);
  const repos = p.repos.map(short).join(", ");
  const evidence = [acts.length ? `${acts.join(" + ")} on ${repos}` : `starred ${repos}`];
  const kw = (p.bio ?? "").match(/\b(mcp|agents?|llms?|ai|security|platform|devops|infra\w*|sre|cto|founder|lead|staff|principal)\b/gi);
  if (kw) evidence.push(`bio: ${[...new Set(kw.map((k) => k.toLowerCase()))].slice(0, 4).join(", ")}`);
  const parts = [
    `${PERSONA_LABEL[j.persona] ?? j.persona} (${pct(j.persona_p)})`,
    `MCP: ${ADOPTION_LABEL[Math.round(j.adoption)]} — ${evidence.join("; ")}`,
    `${SECURITY_LABEL[Math.round(j.security)]} (${pct(j.security_conf)} conf)`,
    j.real_company >= 0.5 ? `operating company${p.company ? ` ${p.company.replace(/^@/, "").trim()}` : ""} (${pct(j.real_company)})` : `employer unclear (${pct(1 - j.real_company)})`,
  ];
  if (j.enterprise >= 0.6) parts.push("known enterprise");
  return parts.join(" · ");
}

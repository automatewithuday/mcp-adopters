export type Profile = {
  login: string;
  name: string | null;
  company: string | null;
  bio: string | null;
  website: string | null;
  linkedin: string | null;
  github_email: string | null;
  followers: number;
  repos: string[];
  signals: string[];
  company_domain?: string | null;
};

const FREEMAIL = /@(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|proton|protonmail|pm|qq|163|126|foxmail|yandex|gmx|aol|mail|privaterelay\.appleid)\./i;
// company field only: schools, and "not a company" placeholders
const COMPANY_DROP = /universi|college|school|institute of technology|大学|学院|student|freelanc|independent|self[- ]?employed|individual|personal|unemployed|home|none|n\/a|^-+$/i;
// bio only: self-declared students
const BIO_DROP = /\b(student|undergrad(uate)?|phd candidate|学生)\b|大学生/i;
const EDU_DOMAIN = /\.(edu|ac)(\.[a-z]{2})?$|\.edu\.[a-z]{2}$/i;
const BOT = /\[bot\]$|^dependabot|(^|[-_])bot$|^github-actions/i;
const TITLE_KEYWORDS = /\b(security|appsec|devsecops|ciso|platform|devops|sre|infra|infrastructure|cto|founder|head|lead|staff|principal|ml|ai)\b/i;
export const HOSTING_DOMAIN = /(^|\.)(github\.io|github\.com|vercel\.app|netlify\.app|itch\.io|linkedin\.com|twitter\.com|x\.com|medium\.com|dev\.to|substack\.com|notion\.site|pages\.dev|herokuapp\.com|carrd\.co|bio\.link|linktr\.ee|youtube\.com|t\.me)$/i;

export const isFreemail = (email: string) => FREEMAIL.test(email);

export function normalizeCompany(c: string | null): string | null {
  const s = (c ?? "").replace(/^@/, "").trim();
  if (!s) return null;
  // ponytail: only lowercase-only names get title-cased; "TATA TCS" / "IBM" stay as typed
  return s === s.toLowerCase() ? s.replace(/\b\w/g, (ch) => ch.toUpperCase()) : s;
}

/** First email found in free text (bios often say "Email: x@y.com"). */
export function emailInText(text: string | null): string | null {
  const m = (text ?? "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : null;
}

/** Trust a website domain as the company domain only when it echoes the company name. */
export function websiteMatchesCompany(domain: string | null, company: string | null): boolean {
  if (!domain || !company) return false;
  const host = domain.split(".").slice(0, -1).join("").toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = company.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 4 && !/^(inc|corp|corporation|limited|ltd|llc|gmbh|group|technologies|technology|labs|software|company|solutions)$/.test(t));
  return tokens.some((t) => host.includes(t));
}

export function qualify(p: Profile): { qualified: boolean; score: number; company_norm: string | null } {
  const company_norm = normalizeCompany(p.company);
  const corpEmail = !!p.github_email && !isFreemail(p.github_email);
  const dropped =
    BOT.test(p.login) ||
    COMPANY_DROP.test(p.company ?? "") ||
    BIO_DROP.test(p.bio ?? "") ||
    EDU_DOMAIN.test(p.company_domain ?? "") ||
    (!p.name && !company_norm && !p.bio && !p.linkedin && !p.website);
  const qualified = !dropped && !!(company_norm || p.linkedin || corpEmail || p.company_domain);
  if (!qualified) return { qualified: false, score: 0, company_norm };

  let score = 0;
  if (p.linkedin) score += 30;
  if (company_norm) score += 25;
  if (TITLE_KEYWORDS.test(p.bio ?? "")) score += 20;
  if (corpEmail) score += 15;
  if (p.signals.some((s) => s !== "WatchEvent")) score += 10;
  score += Math.max(0, p.repos.length - 1) * 5;
  if (p.followers >= 50) score += 5;
  return { qualified: true, score: Math.min(100, score), company_norm };
}

import { OWNER_ALIASES } from "../repos.ts";
export const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Works for the vendor that ships a repo they actively contributed to (fork/issue/PR), judged by the
 * company field or an "at <owner>" / "@<owner>" phrase in the bio. Sellers of MCP, not buyers.
 */
export function isMaintainer(p: { company: string | null; bio: string | null; repos: string[]; signals: string[] }): boolean {
  if (!p.signals.some((s) => s !== "WatchEvent")) return false;
  const company = alnum(p.company ?? "");
  const bioAt = [...(p.bio ?? "").matchAll(/(?:\bat|@)\s*([A-Za-z0-9][A-Za-z0-9 .-]{1,30})/g)].map((m) => alnum(m[1]));
  for (const repo of p.repos) {
    const owner = repo.split("/")[0].toLowerCase();
    const names = OWNER_ALIASES[owner] ?? [owner];
    if (names.some((n) => (company && (company === n || company.startsWith(n))) || bioAt.some((b) => b === n || b.startsWith(n)))) return true;
  }
  return false;
}

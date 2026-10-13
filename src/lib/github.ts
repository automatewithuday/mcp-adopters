import type { Profile } from "./qualify.ts";

const headers = () => ({
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "mcp-prospecting",
});

export type GhProfile = Omit<Profile, "repos" | "signals"> & {
  location: string | null;
  twitter: string | null;
};

const FIELDS = (withEmail: boolean) =>
  `login name company bio websiteUrl location twitterUsername ${withEmail ? "email" : ""} followers{totalCount} socialAccounts(first:6){nodes{provider url}}`;

/** Up to 100 logins per call (one GraphQL point). Deleted/suspended users are omitted. */
export async function profiles(logins: string[], withEmail = true): Promise<GhProfile[]> {
  const safe = logins.filter((l) => /^[A-Za-z0-9-]+$/.test(l)).slice(0, 100);
  const query = `query{${safe.map((l, i) => `u${i}:user(login:"${l}"){${FIELDS(withEmail)}}`).join(" ")} rateLimit{remaining}}`;
  const res = await fetch("https://api.github.com/graphql", { method: "POST", headers: headers(), body: JSON.stringify({ query }) });
  if (!res.ok) throw new Error(`github graphql ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: Record<string, any>; errors?: { type?: string; message: string }[] };
  if (!json.data && json.errors?.some((e) => e.type === "INSUFFICIENT_SCOPES") && withEmail) {
    // ponytail: token without read:user → public email field unavailable, proceed without it
    return profiles(logins, false);
  }
  if (!json.data) throw new Error(`github graphql: ${JSON.stringify(json.errors).slice(0, 300)}`);
  const { rateLimit, ...users } = json.data;
  if (rateLimit?.remaining < 200) throw new Error(`github rate limit low: ${rateLimit.remaining}`);
  return Object.values(users).filter(Boolean).map((u: any) => ({
    login: u.login,
    name: u.name || null,
    company: u.company || null,
    bio: u.bio || null,
    website: u.websiteUrl || null,
    location: u.location || null,
    twitter: u.twitterUsername || null,
    github_email: u.email || null,
    followers: u.followers?.totalCount ?? 0,
    linkedin: u.socialAccounts?.nodes?.find((s: any) => s.provider === "LINKEDIN")?.url ?? null,
  }));
}

const orgCache = new Map<string, string | null>();
/** Website domain of a GitHub org, for "@org" company strings. Free REST call, cached per process. */
export async function orgDomain(org: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]+$/.test(org)) return null;
  if (orgCache.has(org)) return orgCache.get(org)!;
  const res = await fetch(`https://api.github.com/orgs/${org}`, { headers: headers() });
  const blog = res.ok ? ((await res.json()) as any).blog : null;
  const d = domainOf(blog);
  orgCache.set(org, d);
  return d;
}

export function domainOf(urlOrEmail: string | null | undefined): string | null {
  if (!urlOrEmail) return null;
  const s = urlOrEmail.includes("@") ? urlOrEmail.split("@")[1] : urlOrEmail.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  const d = s?.toLowerCase().replace(/^www\./, "").trim();
  if (!d || !d.includes(".")) return null;
  // ponytail: collapse subdomains (developer.oracle.com → oracle.com); keeps two-part TLDs like co.uk
  const parts = d.split(".");
  const n = /^(co|com|org|net|ac|gov|edu)$/.test(parts[parts.length - 2] ?? "") && parts.length > 2 ? 3 : 2;
  return parts.slice(-n).join(".");
}

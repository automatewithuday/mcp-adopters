// Local runner: same pipeline functions as the Trigger.dev tasks, no Trigger needed.
//   npx tsx scripts/run.ts discover [--min-stars 1000]        # GitHub search → repos.json (review the diff, then fetch)
//   npx tsx scripts/run.ts fetch   --days 30 --limit 300 [--repos a/b,c/d] [--source builders] [--force]
//   npx tsx scripts/run.ts rank    [--limit 200] [--force]    # TypeSafe judgments + rank for qualified people
//   npx tsx scripts/run.ts enrich  --run-id review --max-usd 0 --min-rank 40 --limit 50
//   npx tsx scripts/run.ts reprofile            # re-run profiles+rules for everyone already profiled
//   npx tsx scripts/run.ts icp     --icp ~/path/client-profile.yaml --run-id icp1 --max-usd 1 --min-rank 40 [--force] [--limit N]
//   npx tsx scripts/run.ts icp     --icp <yaml> --run-id icp2 --max-usd 5 --unknowns   # domain fallback on companies name search missed
//   npx tsx scripts/run.ts activity --run-id act1 --max-usd 1 --min-rank 40 --limit 50 [--icp <yaml>]
//   npx tsx scripts/run.ts report
import { parseArgs } from "node:util";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = execSync("gh auth token").toString().trim(); // ponytail: local fallback, no read:user scope → no github_email

const { db, all } = await import("../src/lib/db.ts");
const { searchRepos } = await import("../src/lib/discover.ts");
const { chunk, fetchActorsStep, fetchProfilesStep, rankStep, enrichCandidates, enrichPersonStep, icpCandidates, icpUnknowns, icpStep, activityCandidates, activityStep } = await import("../src/lib/pipeline.ts");
const { loadIcp } = await import("../src/lib/icp.ts");
const { SEED_REPOS } = await import("../src/repos.ts");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string", default: "365" }, limit: { type: "string" }, repos: { type: "string" },
    source: { type: "string", default: "repos" }, "min-stars": { type: "string", default: "1000" },
    force: { type: "boolean", default: false }, unknowns: { type: "boolean", default: false },
    "run-id": { type: "string", default: "local" }, "max-usd": { type: "string", default: "0" }, "min-rank": { type: "string", default: "40" },
    icp: { type: "string", default: process.env.ICP_PROFILE }, // client-profile.yaml; when given, enrich/activity only take icp_fit = true
  },
});
const icpPath = values.icp;
const cmd = positionals[0];
const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

if (cmd === "discover") {
  const found = await searchRepos(Number(values["min-stars"]));
  const prev = JSON.parse(readFileSync("repos.json", "utf8")) as { repo: string; stars: number; desc: string; curated?: boolean }[];
  const curated = prev.filter((r) => r.curated && !found.some((f) => f.repo === r.repo));
  const next = [...found, ...curated].sort((a, b) => b.stars - a.stars);
  writeFileSync("repos.json", JSON.stringify(next, null, 2) + "\n");
  console.log(`repos.json: ${next.length} repos (${found.length} found, ${curated.length} curated kept). Review the git diff before fetching.`);
} else if (cmd === "fetch") {
  if (values.source !== "repos" && values.source !== "builders") { console.error("--source must be repos or builders"); process.exit(1); }
  const repos = values.repos ? values.repos.split(",") : SEED_REPOS;
  let logins = await fetchActorsStep(repos, Number(values.days), values.source);
  console.log(`actors: ${logins.length}`);
  if (!values.force) {
    // resumable: already-profiled people are skipped (`reprofile` refreshes them)
    const todo = new Set((await all((a, b) => db.from("people").select("login").is("fetched_at", null).order("login").range(a, b))).map((r) => r.login));
    logins = logins.filter((l) => todo.has(l));
    console.log(`unprofiled: ${logins.length}`);
  }
  if (values.limit) logins = logins.slice(0, Number(values.limit));
  let resolved = 0, qualified = 0;
  for (const batch of chunk(logins, 100)) {
    const r = await fetchProfilesStep(batch);
    resolved += r.resolved; qualified += r.qualified;
    console.log(`profiles ${resolved}/${logins.length} resolved, ${qualified} qualified`);
  }
} else if (cmd === "reprofile") {
  const { data } = await db.from("people").select("login").not("fetched_at", "is", null);
  const logins = (data ?? []).map((r) => r.login);
  let resolved = 0, qualified = 0;
  for (const batch of chunk(logins, 100)) {
    const r = await fetchProfilesStep(batch);
    resolved += r.resolved; qualified += r.qualified;
  }
  console.log(`reprofiled ${resolved}/${logins.length}, ${qualified} qualified`);
} else if (cmd === "rank") {
  const rows = await all((a, b) => {
    let q = db.from("people").select("login").eq("qualified", true).order("score", { ascending: false }).order("login").range(a, b);
    return values.force ? q : q.is("ranked_at", null);
  });
  const logins = rows.slice(0, Number(values.limit ?? Infinity)).map((r) => r.login);
  console.log(`to rank: ${logins.length}`);
  let done = 0;
  for (const batch of chunk(logins, 40)) { done += (await rankStep(batch)).ranked; console.log(`ranked ${done}/${logins.length}`); }
} else if (cmd === "icp") {
  if (!icpPath) { console.error("icp needs --icp <client-profile.yaml> (or ICP_PROFILE)"); process.exit(1); }
  const icp = loadIcp(icpPath);
  console.log("ICP:", JSON.stringify(icp));
  let companies = values.unknowns ? await icpUnknowns() : await icpCandidates(values.force, Number(values["min-rank"]));
  if (values.limit) companies = companies.slice(0, Number(values.limit));
  console.log(`companies to check: ${companies.length}${values.unknowns ? " (domain fallback only)" : ""}`);
  const tally: Record<string, number> = {};
  // ponytail: 4 lookups in flight; the cap check is read-then-write, so a run can overshoot --max-usd by at most 3 lookups (~$0.01)
  for (const batch of chunk(companies, 4)) {
    const rs = await Promise.all(batch.map((c) => icpStep({ ...c, runId: values["run-id"]!, maxUsd: Number(values["max-usd"]), icp, fallbackOnly: values.unknowns })));
    rs.forEach((r, i) => {
      const label = r.reason === "skipped_cap" ? "skipped_cap" : String(r.fit);
      tally[label] = (tally[label] ?? 0) + 1;
      console.log(`${label.padEnd(11)} ${batch[i].key} | ${batch[i].name ?? ""} | ${r.reason}`);
    });
  }
  console.table(tally);
  const { data } = await db.rpc("run_spend", { rid: values["run-id"] });
  console.log(`spend for run ${values["run-id"]}: $${Number(data).toFixed(3)}`);
} else if (cmd === "activity") {
  const people = await activityCandidates(Number(values["min-rank"]), Number(values.limit ?? 50), !!icpPath);
  console.log(`linkedin-channel people to check: ${people.length}`);
  for (const p of people) {
    const r = await activityStep({ ...p, runId: values["run-id"]!, maxUsd: Number(values["max-usd"]) });
    console.log(`${r.activity_status.padEnd(11)} ${r.outreach_ready ? "ready " : "      "} ${p.login} ${p.linkedin}`);
  }
  const { data } = await db.rpc("run_spend", { rid: values["run-id"] });
  console.log(`spend for run ${values["run-id"]}: $${Number(data).toFixed(3)}`);
} else if (cmd === "enrich") {
  const logins = await enrichCandidates(Number(values["min-rank"]), Number(values.limit ?? 50), !!icpPath);
  console.log(`candidates: ${logins.length}`);
  for (const login of logins) {
    const r = await enrichPersonStep({ login, runId: values["run-id"]!, maxUsd: Number(values["max-usd"]) }, sleep);
    console.log(r.login, r.email_source, r.tools.join(",") || "-");
  }
  const { data } = await db.rpc("run_spend", { rid: values["run-id"] });
  console.log(`spend for run ${values["run-id"]}: $${Number(data).toFixed(3)}`);
} else if (cmd === "report") {
  const n = async (q: any) => (await q).count ?? 0;
  const total = await n(db.from("people").select("*", { count: "exact", head: true }));
  const fetched = await n(db.from("people").select("*", { count: "exact", head: true }).not("fetched_at", "is", null));
  const qualified = await n(db.from("people").select("*", { count: "exact", head: true }).eq("qualified", true));
  const withEmail = await n(db.from("people").select("*", { count: "exact", head: true }).not("github_email", "is", null));
  const withLinkedin = await n(db.from("people").select("*", { count: "exact", head: true }).not("linkedin", "is", null));
  const contacts = await n(db.from("contacts").select("*", { count: "exact", head: true }));
  const contactsEmail = await n(db.from("contacts").select("*", { count: "exact", head: true }).not("email", "is", null));
  console.table({ people: total, profiled: fetched, qualified, github_email: withEmail, linkedin: withLinkedin, contacts, contacts_with_email: contactsEmail });
  // ICP verdicts per company, and the channel a rep would use per person
  type Pg<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  type CoRow = { icp_fit: boolean | null; icp_reason: string | null };
  const cos: CoRow[] = await all((a: number, b: number) => db.from("companies").select("icp_fit,icp_reason").not("checked_at", "is", null).order("key").range(a, b) as Pg<CoRow>);
  if (cos.length) console.table({ companies_checked: cos.length, icp_fit: cos.filter((c) => c.icp_fit === true).length, icp_out: cos.filter((c) => c.icp_fit === false).length, icp_unknown: cos.filter((c) => c.icp_fit == null).length, provider_errors: cos.filter((c) => c.icp_reason?.startsWith("error:")).length });
  type OqRow = { channel: string; icp_fit: boolean | null; outreach_ready: boolean | null };
  const oq: OqRow[] = await all((a: number, b: number) => db.from("outreach_queue").select("channel,icp_fit,outreach_ready").order("login").range(a, b) as Pg<OqRow>);
  if (oq.length) {
    const by = (f: (r: any) => boolean) => oq.filter(f).length;
    console.table({
      email: by((r) => r.channel === "email"), linkedin: by((r) => r.channel === "linkedin"), none: by((r) => r.channel === "none"),
      linkedin_icp_fit: by((r) => r.channel === "linkedin" && r.icp_fit === true),
      linkedin_outreach_ready: by((r) => r.channel === "linkedin" && r.outreach_ready === true),
    });
  }
  const { data: top } = await db.from("people").select("login,name,company_norm,rank,score,reasoning,maintainer").eq("qualified", true).order("rank", { ascending: false, nullsFirst: false }).order("score", { ascending: false }).limit(20);
  for (const r of top ?? []) console.log(`${String(r.rank ?? "-").padStart(3)} | ${r.login} | ${r.name ?? ""} | ${r.company_norm ?? ""}${r.maintainer ? " | MAINTAINER" : ""}\n      ${r.reasoning ?? "(not ranked)"}`);
} else {
  console.error("usage: discover | fetch | reprofile | rank | icp | enrich | activity | report"); process.exit(1);
}

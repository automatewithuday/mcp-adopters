// Local runner: same pipeline functions as the Trigger.dev tasks, no Trigger needed.
//   npx tsx scripts/run.ts fetch   --days 30 --limit 300 [--repos a/b,c/d]
//   npx tsx scripts/run.ts rank    [--limit 200] [--force]    # TypeSafe judgments + rank for qualified people
//   npx tsx scripts/run.ts enrich  --run-id review --max-usd 0 --min-rank 40 --limit 50
//   npx tsx scripts/run.ts reprofile            # re-run profiles+rules for everyone already profiled
//   npx tsx scripts/run.ts icp     --icp ~/path/client-profile.yaml --run-id icp1 --max-usd 1 [--force]
//   npx tsx scripts/run.ts activity --run-id act1 --max-usd 1 --min-rank 40 --limit 50 [--icp <yaml>]
//   npx tsx scripts/run.ts report
import { parseArgs } from "node:util";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = execSync("gh auth token").toString().trim(); // ponytail: local fallback, no read:user scope → no github_email

const { db } = await import("../src/lib/db.ts");
const { chunk, fetchActorsStep, fetchProfilesStep, rankStep, enrichCandidates, enrichPersonStep, icpCandidates, icpStep, activityCandidates, activityStep } = await import("../src/lib/pipeline.ts");
const { loadIcp } = await import("../src/lib/icp.ts");
const { SEED_REPOS } = await import("../src/repos.ts");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    days: { type: "string", default: "365" }, limit: { type: "string" }, repos: { type: "string" },
    force: { type: "boolean", default: false },
    "run-id": { type: "string", default: "local" }, "max-usd": { type: "string", default: "0" }, "min-rank": { type: "string", default: "40" },
    icp: { type: "string", default: process.env.ICP_PROFILE }, // client-profile.yaml; when given, enrich/activity only take icp_fit = true
  },
});
const icpPath = values.icp;
const cmd = positionals[0];
const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

if (cmd === "fetch") {
  const repos = values.repos ? values.repos.split(",") : SEED_REPOS;
  let logins = await fetchActorsStep(repos, Number(values.days));
  console.log(`actors: ${logins.length}`);
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
  let q = db.from("people").select("login").eq("qualified", true).order("score", { ascending: false }).limit(Number(values.limit ?? 5000));
  if (!values.force) q = q.is("ranked_at", null);
  const { data } = await q;
  const logins = (data ?? []).map((r) => r.login);
  let done = 0;
  for (const batch of chunk(logins, 40)) { done += (await rankStep(batch)).ranked; console.log(`ranked ${done}/${logins.length}`); }
} else if (cmd === "icp") {
  if (!icpPath) { console.error("icp needs --icp <client-profile.yaml> (or ICP_PROFILE)"); process.exit(1); }
  const icp = loadIcp(icpPath);
  console.log("ICP:", JSON.stringify(icp));
  const companies = await icpCandidates(values.force);
  console.log(`companies to check: ${companies.length}`);
  const tally: Record<string, number> = {};
  for (const c of companies) {
    const r = await icpStep({ ...c, runId: values["run-id"]!, maxUsd: Number(values["max-usd"]), icp });
    const label = r.reason === "skipped_cap" ? "skipped_cap" : String(r.fit);
    tally[label] = (tally[label] ?? 0) + 1;
    console.log(`${label.padEnd(11)} ${c.key} | ${c.name ?? ""} | ${r.reason}`);
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
  const all = await n(db.from("people").select("*", { count: "exact", head: true }));
  const fetched = await n(db.from("people").select("*", { count: "exact", head: true }).not("fetched_at", "is", null));
  const qualified = await n(db.from("people").select("*", { count: "exact", head: true }).eq("qualified", true));
  const withEmail = await n(db.from("people").select("*", { count: "exact", head: true }).not("github_email", "is", null));
  const withLinkedin = await n(db.from("people").select("*", { count: "exact", head: true }).not("linkedin", "is", null));
  const contacts = await n(db.from("contacts").select("*", { count: "exact", head: true }));
  const contactsEmail = await n(db.from("contacts").select("*", { count: "exact", head: true }).not("email", "is", null));
  console.table({ people: all, profiled: fetched, qualified, github_email: withEmail, linkedin: withLinkedin, contacts, contacts_with_email: contactsEmail });
  // ICP verdicts per company, and the channel a rep would use per person
  const { data: cos } = await db.from("companies").select("icp_fit").limit(10000);
  if (cos?.length) console.table({ companies_checked: cos.length, icp_fit: cos.filter((c) => c.icp_fit === true).length, icp_out: cos.filter((c) => c.icp_fit === false).length, icp_unknown: cos.filter((c) => c.icp_fit == null).length });
  const { data: oq } = await db.from("outreach_queue").select("channel,icp_fit,outreach_ready").limit(10000);
  if (oq?.length) {
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
  console.error("usage: fetch | reprofile | rank | icp | enrich | activity | report"); process.exit(1);
}

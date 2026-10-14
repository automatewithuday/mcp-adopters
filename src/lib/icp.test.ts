import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadIcp, icpFit, verifiedCompany, companyKey } from "./icp.ts";

const icp = { headcount_min: 100, headcount_max: 5000, countries: ["US", "CA"] };

test("loadIcp reads only the hard filters it enforces", () => {
  const p = join(tmpdir(), `icp-${process.pid}.yaml`);
  writeFileSync(p, `business:\n  name: x\nicp_hard_filters:\n  job_titles: [CTO]\n  headcount_min: 100\n  headcount_max: 5000\n  countries: [us, ca]\n`);
  assert.deepEqual(loadIcp(p), icp);
  writeFileSync(p, `business:\n  name: x\n`);
  assert.throws(() => loadIcp(p), /icp_hard_filters/);
});

test("icpFit: exact headcount and HQ", () => {
  assert.equal(icpFit({ employees: 1200, hq_country: "US" }, icp).fit, true);
  assert.equal(icpFit({ employees: 50, hq_country: "US" }, icp).fit, false);
  assert.equal(icpFit({ employees: 1200, hq_country: "DE" }, icp).fit, false);
  assert.equal(icpFit({ employees: 20000, hq_country: "US" }, icp).fit, false);
});

test("icpFit: listed vs declared headcount, the larger wins; unknowns stay null; a fail beats an unknown", () => {
  assert.equal(icpFit({ employees_min: 51, employees_max: 200, hq_country: "CA" }, icp).fit, false);   // range only: its floor, 51
  assert.equal(icpFit({ employees_min: 201, employees_max: 500, hq_country: "CA" }, icp).fit, true);
  assert.equal(icpFit({ employees_min: 10001, employees_max: null, hq_country: "CA" }, icp).fit, false);
  // sub-brand page: 496 listed under a 10001+ declared range → 10001
  const sub = icpFit({ employees: 496, employees_min: 10001, employees_max: null, hq_country: "US" }, icp);
  assert.equal(sub.fit, false); assert.match(sub.reason, /~10001 \(listed 496, declared 10001-\) outside/);
  // stale declared range: 21029 listed under 1001-5000 → 21029
  assert.equal(icpFit({ employees: 21029, employees_min: 1001, employees_max: 5000, hq_country: "US" }, icp).fit, false);
  assert.equal(icpFit({ employees: 73, employees_min: 51, employees_max: 200, hq_country: "US" }, icp).fit, false);  // agree: 73
  assert.equal(icpFit({ hq_country: "US" }, icp).fit, null);
  assert.equal(icpFit({ employees: 1200 }, icp).fit, null);
  assert.equal(icpFit({ employees: 5, hq_country: null }, icp).fit, false);
  assert.match(icpFit({ employees: 1200, hq_country: "US" }, icp).reason, /employees 1200 in 100-5000; HQ US in US,CA/);
  assert.equal(icpFit({ employees: 1 }, {}).fit, true);
});

test("verifiedCompany: domain wins, name only when no domain was known", () => {
  assert.equal(verifiedCompany({ name: "Netflix", domain: "https://www.netflix.com/" }, { name: "Netflix", domain: "netflix.com" }), true);
  assert.equal(verifiedCompany({ name: "Netflix", domain: "https://netflix.jobs" }, { name: "Netflix", domain: "netflix.com" }), false);
  assert.equal(verifiedCompany({ name: "Acme Corp.", domain: null }, { name: "acme-corp", domain: null }), true);
  assert.equal(verifiedCompany({ name: "Acme Robotics", domain: null }, { name: "Acme", domain: null }), false);
  assert.equal(verifiedCompany({ name: "Akamai Technologies", domain: null }, { name: "Akamai Technologies Inc.", domain: null }), true);
  assert.equal(verifiedCompany({ name: "Cinnamon Inc.", domain: null }, { name: "Cinnamon", domain: null }), true);
  assert.equal(verifiedCompany({ name: "Inc.", domain: null }, { name: "Inc", domain: null }), false);
  assert.equal(verifiedCompany({ name: "Acme" }, { name: null, domain: null }), false);
  // page lists no website: fall back to the name
  assert.equal(verifiedCompany({ name: "Agency Handy", domain: null }, { name: "Agencyhandy", domain: "agencyhandy.com" }), true);
  assert.equal(verifiedCompany({ name: "ACE Advising & Consulting", domain: null }, { name: "Aceadvising", domain: "aceadvising.com" }), false);
});

test("companyKey: normalised name, else domain", () => {
  assert.equal(companyKey("Montanha Tech", null), "montanhatech");
  assert.equal(companyKey(null, "fis.com"), "fis.com");
  assert.equal(companyKey("@", null), null);
});

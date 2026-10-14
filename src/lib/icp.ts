// ICP gate at the company level. Thresholds come from the owner's client-profile.yaml (icp-onboarding skill),
// never from code. Only icp_hard_filters.headcount_min/max and .countries are read; see README.
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { alnum } from "./qualify.ts";
import { domainOf } from "./github.ts";
import type { Firmographics } from "./providers/types.ts";

export type Icp = { headcount_min?: number; headcount_max?: number; countries?: string[] };

/** client-profile.yaml → the subset of icp_hard_filters this pipeline enforces. */
export function loadIcp(path: string): Icp {
  const doc = parse(readFileSync(path, "utf8"));
  const h = doc?.icp_hard_filters;
  if (!h || typeof h !== "object") throw new Error(`${path}: no icp_hard_filters section`);
  const icp: Icp = {};
  if (h.headcount_min != null) icp.headcount_min = Number(h.headcount_min);
  if (h.headcount_max != null) icp.headcount_max = Number(h.headcount_max);
  if (Array.isArray(h.countries) && h.countries.length) icp.countries = h.countries.map((c: unknown) => String(c).toUpperCase());
  return icp;
}

/** Stable per-company id: the normalised name, or the domain when the profile has no company name. */
export const companyKey = (company_norm: string | null, domain: string | null): string | null =>
  alnum(company_norm ?? "") || domain || null;

/**
 * Did the provider return the company we asked about? LinkedIn name search can land on a namesake.
 * Accept a domain match; when either side has no domain, an exact normalised-name match (pages often list no website).
 */
export function verifiedCompany(f: Firmographics, want: { name: string | null; domain: string | null }): boolean {
  const got = domainOf(f.domain);
  if (want.domain && got) return got === want.domain;
  return !!want.name && !!f.name && !!bareName(want.name) && bareName(f.name) === bareName(want.name);
}

/** "Akamai Technologies Inc." and "Akamai Technologies" are the same company: drop legal suffixes before comparing. */
const LEGAL_SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|gmbh|ag|sa|pvt|pty|bv|oy|ab|srl|sas|kk)\b\.?/gi;
const bareName = (s: string) => alnum(s.replace(LEGAL_SUFFIX, " "));

/** null = can't tell (missing headcount or HQ). Reason is one line a rep can read. */
export function icpFit(f: Firmographics, icp: Icp): { fit: boolean | null; reason: string } {
  const parts: string[] = [];
  let fit = true as boolean | null; // widened: TS otherwise narrows to `true` inside the branches below
  const wantsSize = icp.headcount_min != null || icp.headcount_max != null;
  if (wantsSize) {
    const lo = icp.headcount_min ?? 0, hi = icp.headcount_max ?? Infinity;
    // LinkedIn gives two noisy numbers: people listing the page (`employees`) and the self-declared size range.
    // A sub-brand page under-counts (Dell EMC XtremIO: 496 listed, 10001+ declared); a stale range under-declares
    // (SpaceX: 21029 listed, 1001-5000 declared). Taking the larger of the two fixes both; the reason shows the conflict.
    // ponytail: owner rule; flip to min() or "both must agree → else null" if too many big companies slip through
    const listed = f.employees ?? null, declaredMin = f.employees_min ?? null;
    const est = Math.max(listed ?? -1, declaredMin ?? -1);
    if (est >= 0) {
      const ok = est >= lo && est <= hi;
      const conflict = listed != null && declaredMin != null && (listed < declaredMin || listed > (f.employees_max ?? Infinity));
      const shown = conflict ? `~${est} (listed ${listed}, declared ${declaredMin}-${f.employees_max ?? ""})` : String(est);
      parts.push(`employees ${shown} ${ok ? "in" : "outside"} ${lo}-${hi === Infinity ? "" : hi}`);
      if (!ok) fit = false;
    } else { parts.push("headcount unknown"); fit = fit === false ? false : null; }
  }
  if (icp.countries?.length) {
    if (f.hq_country) {
      const ok = icp.countries.includes(f.hq_country);
      parts.push(`HQ ${f.hq_country} ${ok ? "in" : "not in"} ${icp.countries.join(",")}`);
      if (!ok) fit = false;
    } else { parts.push("HQ unknown"); fit = fit === false ? false : null; }
  }
  return { fit, reason: parts.join("; ") || "no ICP filters" };
}

import fs from "fs";
import path from "path";
import { CompanyRegistryEntry, JobRecord } from "../types/jobs";
import { fetchGreenhouseJobs } from "./greenhouseFetcher";
import { fetchLeverJobs } from "./leverFetcher";
import { fetchAshbyJobs } from "./ashbyFetcher";

export interface DiscoveryResult {
  jobs: JobRecord[];
  countsByAts: Record<string, number>;
  countsByCompany: Record<string, number>;
  failures: Array<{ name: string; ats: string; slug: string; error: string }>;
}

export async function discoverJobs(registryPath: string): Promise<DiscoveryResult> {
  const companies = loadCompanyRegistry(registryPath);
  const jobs: JobRecord[] = [];
  const countsByAts: Record<string, number> = {};
  const countsByCompany: Record<string, number> = {};
  const failures: Array<{ name: string; ats: string; slug: string; error: string }> = [];

  for (const company of companies) {
    try {
      let fetched: JobRecord[] = [];
      if (company.ats === "greenhouse") {
        fetched = await fetchGreenhouseJobs(company.slug, company.name);
      } else if (company.ats === "lever") {
        fetched = await fetchLeverJobs(company.slug, company.name);
      } else if (company.ats === "ashby") {
        fetched = await fetchAshbyJobs(company.slug, company.name);
      }
      jobs.push(...fetched);
      countsByAts[company.ats] = (countsByAts[company.ats] ?? 0) + fetched.length;
      countsByCompany[company.name] = fetched.length;
    } catch (error) {
      failures.push({
        name: company.name,
        ats: company.ats,
        slug: company.slug,
        error: error instanceof Error ? error.message : String(error),
      });
      countsByCompany[company.name] = 0;
    }
  }

  return { jobs, countsByAts, countsByCompany, failures };
}

export function loadCompanyRegistry(registryPath: string): CompanyRegistryEntry[] {
  const resolved = path.resolve(registryPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Company registry not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf8");
  const data = JSON.parse(raw) as CompanyRegistryEntry[];
  return data;
}

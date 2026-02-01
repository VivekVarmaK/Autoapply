import { JobRecord } from "../types/jobs";

interface GreenhouseJob {
  id: number;
  title: string;
  location?: { name?: string };
  departments?: Array<{ name?: string }>;
  absolute_url?: string;
}

export async function fetchGreenhouseJobs(companySlug: string, companyName: string): Promise<JobRecord[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${companySlug}/jobs?content=true`;
  const response = await fetch(url, { headers: { "User-Agent": "autoapply" } });
  if (!response.ok) {
    throw new Error(`Greenhouse fetch failed for ${companySlug}: ${response.status} (${url})`);
  }
  const data = (await response.json()) as { jobs?: GreenhouseJob[] };
  const jobs = data.jobs ?? [];
  return jobs.map((job) => ({
    id: String(job.id),
    company: companyName,
    title: job.title ?? "",
    location: job.location?.name ?? "",
    department: job.departments?.[0]?.name,
    ats: "greenhouse",
    companySlug,
    applyUrl: job.absolute_url ?? `https://boards.greenhouse.io/${companySlug}/jobs/${job.id}`,
  }));
}

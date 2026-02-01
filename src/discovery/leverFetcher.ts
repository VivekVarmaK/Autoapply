import { JobRecord } from "../types/jobs";

interface LeverPosting {
  id: string;
  text?: string;
  categories?: {
    location?: string;
    team?: string;
  };
  host?: string;
  applyUrl?: string;
}

export async function fetchLeverJobs(companySlug: string, companyName: string): Promise<JobRecord[]> {
  const url = `https://api.lever.co/v0/postings/${companySlug}`;
  const response = await fetch(url, { headers: { "User-Agent": "autoapply" } });
  if (!response.ok) {
    throw new Error(`Lever fetch failed for ${companySlug}: ${response.status} (${url})`);
  }
  const jobs = (await response.json()) as LeverPosting[];
  return jobs.map((job) => ({
    id: job.id,
    company: companyName,
    title: job.text ?? "",
    location: job.categories?.location ?? "",
    department: job.categories?.team,
    ats: "lever",
    companySlug,
    applyUrl: job.applyUrl ?? `https://jobs.lever.co/${companySlug}/${job.id}`,
  }));
}

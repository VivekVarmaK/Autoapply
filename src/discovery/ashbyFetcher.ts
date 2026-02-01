import { JobRecord } from "../types/jobs";

interface AshbyJobPosting {
  id: string;
  title?: string;
  locationName?: string;
  teamName?: string;
  isListed?: boolean;
}

export async function fetchAshbyJobs(companySlug: string, companyName: string): Promise<JobRecord[]> {
  const url = `https://jobs.ashbyhq.com/${companySlug}`;
  const response = await fetch(url, { headers: { "User-Agent": "autoapply" } });
  if (!response.ok) {
    throw new Error(`Ashby fetch failed for ${companySlug}: ${response.status} (${url})`);
  }

  const html = await response.text();
  const appData = extractAppData(html);
  const postings = (appData?.jobBoard?.jobPostings ?? []) as AshbyJobPosting[];

  return postings
    .filter((posting) => posting.isListed !== false)
    .map((posting) => ({
      id: posting.id,
      company: companyName,
      title: posting.title ?? "",
      location: posting.locationName ?? "",
      department: posting.teamName,
      ats: "ashby",
      companySlug,
      applyUrl: `https://jobs.ashbyhq.com/${companySlug}/${posting.id}`,
    }));
}

function extractAppData(html: string): { jobBoard?: { jobPostings?: AshbyJobPosting[] } } | null {
  const marker = "window.__appData = ";
  const start = html.indexOf(marker);
  if (start === -1) {
    return null;
  }
  const scriptStart = start + marker.length;
  const scriptEnd = html.indexOf("</script>", scriptStart);
  if (scriptEnd === -1) {
    return null;
  }
  const raw = html.slice(scriptStart, scriptEnd).trim();
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return null;
  }
  try {
    return JSON.parse(jsonText) as { jobBoard?: { jobPostings?: AshbyJobPosting[] } };
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return null;
}

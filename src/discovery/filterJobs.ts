import { JobRecord } from "../types/jobs";
import { SearchCriteria } from "../types/boards";

export interface FilterResult {
  matched: JobRecord[];
  counts: {
    total: number;
    matched: number;
    skippedTitle: number;
    skippedLocation: number;
    skippedExclude: number;
    skippedExperience: number;
    skippedRole: number;
    skippedSeniority: number;
  };
}

export function filterJobs(jobs: JobRecord[], prefs: SearchCriteria): FilterResult {
  const counts = {
    total: jobs.length,
    matched: 0,
    skippedTitle: 0,
    skippedLocation: 0,
    skippedExclude: 0,
    skippedExperience: 0,
    skippedRole: 0,
    skippedSeniority: 0,
  };

  const matched: JobRecord[] = [];
  const includeTitles = normalizeList(prefs.titles);
  const includeKeywords = normalizeList(prefs.keywords);
  const excludeKeywords = normalizeList(prefs.excludeKeywords);
  const experienceKeywords = normalizeList(prefs.experience ?? []);
  const locations = normalizeList(prefs.locations);
  const wantsRemote = false;

  for (const job of jobs) {
  const titleText = normalize(job.title);
  const haystack = normalize(`${job.title} ${job.location} ${job.department ?? ""}`);

    if (excludeKeywords.length > 0 && excludeKeywords.some((kw) => haystack.includes(kw))) {
      counts.skippedExclude += 1;
      continue;
    }

    if (includeTitles.length > 0 || includeKeywords.length > 0) {
      const titleHit = includeTitles.length > 0 && includeTitles.some((kw) => haystack.includes(kw));
      const keywordHit = includeKeywords.length > 0 && includeKeywords.some((kw) => haystack.includes(kw));
      if (!(titleHit || keywordHit)) {
        counts.skippedTitle += 1;
        continue;
      }
    }

    if (experienceKeywords.length > 0 && !experienceKeywords.some((kw) => haystack.includes(kw))) {
      counts.skippedExperience += 1;
      continue;
    }

    if (ROLE_FUNCTION_EXCLUDES.some((kw) => titleText.includes(kw))) {
      counts.skippedSeniority += 1;
      continue;
    }

    if (ROLE_HARD_EXCLUDES.some((kw) => titleText.includes(kw))) {
      counts.skippedSeniority += 1;
      continue;
    }

    if (ROLE_TITLE_EXCLUDES.some((kw) => titleText.includes(kw))) {
      counts.skippedSeniority += 1;
      continue;
    }

    const tier1Match = ROLE_KEYWORDS.some((kw) => titleText.includes(kw));
    const tier2Match =
      titleText.includes("analytics") ||
      (titleText.includes("data") && !(titleText.includes("scientist") || titleText.includes("science")));

    if (!(tier1Match || tier2Match)) {
      counts.skippedRole += 1;
      continue;
    }

    if (locations.length > 0 || wantsRemote) {
      const locationText = normalize(job.location);
      if (!isUnitedStatesLocation(locationText)) {
        counts.skippedLocation += 1;
        continue;
      }
      const locationMatch = locations.length === 0 || locations.some((loc) => locationText.includes(loc));
      if (!locationMatch) {
        counts.skippedLocation += 1;
        continue;
      }
    }

    matched.push(job);
  }

  counts.matched = matched.length;
  return { matched, counts };
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function normalizeList(values: string[]): string[] {
  return values.map((value) => normalize(value)).filter((value) => value.length > 0);
}

function isUnitedStatesLocation(locationText: string): boolean {
  if (!locationText) return false;
  if (
    locationText.includes("canada") ||
    locationText.includes("uk") ||
    locationText.includes("united kingdom") ||
    locationText.includes("europe") ||
    locationText.includes("emea") ||
    locationText.includes("apac")
  ) {
    return false;
  }
  const usMarkers = [
    "united states",
    "united states of america",
    "usa",
    "u.s.",
    "us",
    "u.s.a.",
  ];
  if (usMarkers.some((marker) => locationText.includes(marker))) {
    return true;
  }
  const stateNames = [
    "alabama",
    "alaska",
    "arizona",
    "arkansas",
    "california",
    "colorado",
    "connecticut",
    "delaware",
    "florida",
    "georgia",
    "hawaii",
    "idaho",
    "illinois",
    "indiana",
    "iowa",
    "kansas",
    "kentucky",
    "louisiana",
    "maine",
    "maryland",
    "massachusetts",
    "michigan",
    "minnesota",
    "mississippi",
    "missouri",
    "montana",
    "nebraska",
    "nevada",
    "new hampshire",
    "new jersey",
    "new mexico",
    "new york",
    "north carolina",
    "north dakota",
    "ohio",
    "oklahoma",
    "oregon",
    "pennsylvania",
    "rhode island",
    "south carolina",
    "south dakota",
    "tennessee",
    "texas",
    "utah",
    "vermont",
    "virginia",
    "washington",
    "west virginia",
    "wisconsin",
    "wyoming",
    "district of columbia",
    "washington, dc",
  ];
  if (stateNames.some((state) => locationText.includes(state))) {
    return true;
  }
  const stateAbbr = [
    "al",
    "ak",
    "az",
    "ar",
    "ca",
    "co",
    "ct",
    "de",
    "fl",
    "ga",
    "hi",
    "id",
    "il",
    "in",
    "ia",
    "ks",
    "ky",
    "la",
    "me",
    "md",
    "ma",
    "mi",
    "mn",
    "ms",
    "mo",
    "mt",
    "ne",
    "nv",
    "nh",
    "nj",
    "nm",
    "ny",
    "nc",
    "nd",
    "oh",
    "ok",
    "or",
    "pa",
    "ri",
    "sc",
    "sd",
    "tn",
    "tx",
    "ut",
    "vt",
    "va",
    "wa",
    "wv",
    "wi",
    "wy",
    "dc",
  ];
  return stateAbbr.some((abbr) => {
    const pattern = new RegExp(`(^|\\W)${abbr}(\\W|$)`, "i");
    return pattern.test(locationText);
  });
}

const ROLE_KEYWORDS = [
  "data analyst",
  "data engineer",
  "analytics engineer",
  "analytics developer",
  "business intelligence",
  "bi engineer",
  "bi analyst",
];

const ROLE_HARD_EXCLUDES = [
  "senior",
  "sr",
  "sr.",
  "staff",
  "principal",
  "lead",
  "manager",
  "head",
];

const ROLE_TITLE_EXCLUDES = [
  "data scientist",
  "machine learning",
  "ml",
];

const ROLE_FUNCTION_EXCLUDES = [
  "recruiter",
  "recruiting",
  "talent",
  "hr",
  "people",
  "architect",
  "architecture",
  "solutions",
  "solution",
  "sales",
  "marketing",
  "growth",
  "customer",
  "success",
  "support",
  "enablement",
  "evangelist",
  "consultant",
  "advisory",
];

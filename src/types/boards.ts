export interface JobListing {
  id: string;
  board: string;
  url: string;
  title: string;
  company: string;
  location: string;
  postedAt?: string;
  metadata?: Record<string, string>;
}

export interface SearchCriteria {
  titles: string[];
  locations: string[];
  keywords: string[];
  excludeKeywords: string[];
  experience?: string[];
  remote?: boolean;
  hybrid?: boolean;
}

export interface ApplyResult {
  listingId: string;
  status: "submitted" | "failed" | "skipped" | "dry-run";
  message?: string;
  artifacts?: {
    screenshotPath?: string;
    logPath?: string;
  };
}

export interface BoardConnector {
  name: string;
  search(criteria: SearchCriteria, session: AutomationSession): Promise<JobListing[]>;
  apply(listing: JobListing, ctx: ApplyContext): Promise<ApplyResult>;
}

import { ApplyContext } from "../types/context";
import { AutomationSession } from "../automation/session";

import { ApplyResult, JobListing } from "../types/boards";

export interface JobRepo {
  upsert(listing: JobListing): Promise<void>;
  markApplied(listing: JobListing, result: ApplyResult): Promise<void>;
  hasApplied(url: string): Promise<boolean>;
}

export class InMemoryJobRepo implements JobRepo {
  private appliedUrls = new Set<string>();

  async upsert(_listing: JobListing): Promise<void> {
    return;
  }

  async markApplied(listing: JobListing, result: ApplyResult): Promise<void> {
    if (result.status === "submitted" || result.status === "dry-run") {
      this.appliedUrls.add(listing.url);
    }
  }

  async hasApplied(url: string): Promise<boolean> {
    return this.appliedUrls.has(url);
  }
}

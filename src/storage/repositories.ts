import fs from "fs";
import path from "path";
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

export class FileJobRepo implements JobRepo {
  private appliedUrls = new Map<string, { listingId: string; status: ApplyResult["status"]; appliedAt: string }>();
  private filePath: string;

  constructor(dataDir: string, filename = "applied_jobs.json") {
    this.filePath = path.join(dataDir, filename);
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((entry) => {
          if (entry?.url && entry?.status) {
            this.appliedUrls.set(entry.url, {
              listingId: entry.listingId ?? entry.url,
              status: entry.status,
              appliedAt: entry.appliedAt ?? new Date().toISOString(),
            });
          }
        });
      }
    } catch {
      return;
    }
  }

  private persist(): void {
    const payload = Array.from(this.appliedUrls.entries()).map(([url, entry]) => ({
      url,
      listingId: entry.listingId,
      status: entry.status,
      appliedAt: entry.appliedAt,
    }));
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
  }

  async upsert(_listing: JobListing): Promise<void> {
    return;
  }

  async markApplied(listing: JobListing, result: ApplyResult): Promise<void> {
    if (result.status === "submitted" || result.status === "dry-run") {
      this.appliedUrls.set(listing.url, {
        listingId: listing.id,
        status: result.status,
        appliedAt: new Date().toISOString(),
      });
      this.persist();
    }
  }

  async hasApplied(url: string): Promise<boolean> {
    return this.appliedUrls.has(url);
  }
}

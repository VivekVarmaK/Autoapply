import fs from "fs";
import path from "path";
import { JobRecord } from "../types/jobs";

export interface JobStore {
  upsertMany(jobs: JobRecord[]): Promise<void>;
  writeAll(jobs: JobRecord[]): Promise<void>;
  loadAll(): Promise<JobRecord[]>;
}

export class FileJobStore implements JobStore {
  private filePath: string;

  constructor(dataDir: string, filename = "jobs.json") {
    this.filePath = path.join(dataDir, filename);
    fs.mkdirSync(dataDir, { recursive: true });
  }

  async loadAll(): Promise<JobRecord[]> {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    return (JSON.parse(raw) as JobRecord[]) ?? [];
  }

  async upsertMany(jobs: JobRecord[]): Promise<void> {
    if (jobs.length === 0) {
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2));
      return;
    }

    const existing = await this.loadAll();
    const map = new Map(existing.map((job) => [this.key(job), job]));
    for (const job of jobs) {
      map.set(this.key(job), job);
    }
    const merged = Array.from(map.values());
    fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2));
  }

  async writeAll(jobs: JobRecord[]): Promise<void> {
    fs.writeFileSync(this.filePath, JSON.stringify(jobs, null, 2));
  }

  private key(job: JobRecord): string {
    return `${job.ats}:${job.company}:${job.id}`;
  }
}

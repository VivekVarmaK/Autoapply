import { BoardConnector } from "../types/boards";
import { ApplyContext } from "../types/context";
import { JobRepo } from "../storage/repositories";

export interface RunOptions {
  board: string;
  dryRun: boolean;
  maxApplications: number;
  headless: boolean;
}

export interface RunStatus {
  state: "idle" | "running" | "paused" | "stopped";
  appliedCount: number;
  lastMessage?: string;
}

export interface Orchestrator {
  run(options: RunOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  status(): RunStatus;
}

export class SimpleOrchestrator implements Orchestrator {
  private connectors: Map<string, BoardConnector>;
  private jobRepo: JobRepo;
  private ctx: ApplyContext;
  private statusState: RunStatus = { state: "idle", appliedCount: 0 };

  constructor(connectors: Map<string, BoardConnector>, jobRepo: JobRepo, ctx: ApplyContext) {
    this.connectors = connectors;
    this.jobRepo = jobRepo;
    this.ctx = ctx;
  }

  async run(options: RunOptions): Promise<void> {
    const connector = this.connectors.get(options.board);
    if (!connector) {
      this.statusState = { state: "stopped", appliedCount: 0, lastMessage: "Unknown board" };
      return;
    }

    this.statusState = { state: "running", appliedCount: 0 };
    const listings = await connector.search(this.ctx.preferences, this.ctx.automation);

    for (const listing of listings) {
      if (this.statusState.state !== "running") {
        break;
      }

      if (this.statusState.appliedCount >= options.maxApplications) {
        this.statusState = { ...this.statusState, lastMessage: "Reached max applications" };
        break;
      }

      const alreadyApplied = await this.jobRepo.hasApplied(listing.url);
      if (alreadyApplied) {
        continue;
      }

      await this.jobRepo.upsert(listing);
      const result = await connector.apply(listing, { ...this.ctx, dryRun: options.dryRun });
      await this.jobRepo.markApplied(listing, result);
      this.statusState = {
        ...this.statusState,
        appliedCount: this.statusState.appliedCount + (result.status === "skipped" ? 0 : 1),
        lastMessage: result.message,
      };
    }

    if (this.statusState.state === "running") {
      this.statusState = { ...this.statusState, state: "stopped" };
    }
  }

  pause(): void {
    if (this.statusState.state === "running") {
      this.statusState = { ...this.statusState, state: "paused" };
    }
  }

  resume(): void {
    if (this.statusState.state === "paused") {
      this.statusState = { ...this.statusState, state: "running" };
    }
  }

  stop(): void {
    this.statusState = { ...this.statusState, state: "stopped" };
  }

  status(): RunStatus {
    return this.statusState;
  }
}

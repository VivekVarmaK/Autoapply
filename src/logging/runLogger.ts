import fs from "fs";
import path from "path";

export interface RunEvent {
  runId: string;
  listingId: string;
  applyType: string;
  step: string;
  status?: string;
  title?: string;
  company?: string;
  submitPolicy?: "pass" | "fail";
  submitPolicyReason?: string;
  externalUrl?: string;
  externalAts?: string;
  field?: string;
  hint?: string;
  reason?: string;
  timestamp: string;
  screenshotPath?: string;
}

export interface RunLogger {
  logEvent(event: RunEvent): void;
  getLogPath(): string;
}

export function createRunLogger(logDir: string, runId: string): RunLogger {
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `run-${runId}.jsonl`);

  return {
    logEvent(event: RunEvent): void {
      const line = JSON.stringify(event);
      fs.appendFileSync(logPath, `${line}\n`, "utf8");
    },
    getLogPath(): string {
      return logPath;
    },
  };
}

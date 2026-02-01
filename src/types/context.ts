import { SearchCriteria } from "./boards";
import { AutomationSession } from "../automation/session";
import { FormEngine } from "../forms/engine";
import { RunLogger } from "../logging";

export interface UserProfile {
  fullName: string;
  email: string;
  phone: string;
  location?: string;
  workAuthorization?: string;
  sponsorship?: string;
  priorEmployment?: string;
  referralSource?: string;
  state?: string;
  linkedin?: string;
  website?: string;
  github?: string;
  eeo?: {
    gender?: string;
    lgbtq?: string;
    raceEthnicity?: string;
    veteranStatus?: string;
    disabilityStatus?: string;
  };
}

export interface ResumeAsset {
  label: string;
  path: string;
  sha256: string;
  isDefault: boolean;
}

export interface ApplyContext {
  profile: UserProfile;
  resume: ResumeAsset;
  preferences: SearchCriteria;
  dryRun: boolean;
  maxApplications: number;
  automation: AutomationSession;
  formEngine: FormEngine;
  runId: string;
  logDir: string;
  dataDir: string;
  runLogger: RunLogger;
  lastScreenshotPath?: string;
  lastApplyType?: string;
  keepOpen?: boolean;
  pauseOnVerification?: boolean;
}

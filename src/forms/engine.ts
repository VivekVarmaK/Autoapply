import { AutomationPage } from "../automation/session";
import { ResumeAsset, UserProfile } from "../types/context";
import { RunLogger } from "../logging";

export interface FormMeta {
  runId: string;
  listingId: string;
  applyType: string;
  logDir: string;
  runLogger: RunLogger;
  setLastScreenshot: (path: string) => void;
  pauseOnVerification?: boolean;
}

export interface FormEngine {
  mapAndFill(page: AutomationPage, profile: UserProfile, resume: ResumeAsset, meta: FormMeta): Promise<void>;
  answerScreening(page: AutomationPage, profile: UserProfile, meta: FormMeta): Promise<void>;
  detectSubmitState(page: AutomationPage, meta: FormMeta): Promise<SubmitDetection>;
}

export class NullFormEngine implements FormEngine {
  async mapAndFill(
    _page: AutomationPage,
    _profile: UserProfile,
    _resume: ResumeAsset,
    _meta: FormMeta
  ): Promise<void> {
    return;
  }

  async answerScreening(_page: AutomationPage, _profile: UserProfile, _meta: FormMeta): Promise<void> {
    return;
  }

  async detectSubmitState(_page: AutomationPage, _meta: FormMeta): Promise<SubmitDetection> {
    return {
      state: "blocked",
      reason: "not implemented",
      submitPolicy: "fail",
      submitPolicyReason: "not implemented",
    };
  }
}

export interface SubmitDetection {
  state: "ready-to-submit" | "incomplete" | "blocked";
  reason: string;
  submitPolicy: "pass" | "fail";
  submitPolicyReason: string;
  screenshotPath?: string;
}

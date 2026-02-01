import path from "path";
import { AutomationPage } from "../automation/session";
import { ResumeAsset, UserProfile } from "../types/context";
import { FormEngine, FormMeta, SubmitDetection } from "./engine";
import { Logger } from "../logging";

const MAX_STEPS = 5;

export class IndeedFormEngine implements FormEngine {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async mapAndFill(page: AutomationPage, profile: UserProfile, resume: ResumeAsset, meta: FormMeta): Promise<void> {
    this.logger.info("Mapping fields in Indeed apply flow");
    await this.captureStep(page, meta, "before-fill");

    const result = await page.evaluate((data) => {
      type FieldFill = { field: string; reason?: string };

      const filled: FieldFill[] = [];
      const skipped: FieldFill[] = [];
      let fileInputFound = false;

      const textOf = (el: Element | null | undefined): string => el?.textContent?.trim() || "";

      const closestLabel = (el: Element): string => {
        const id = (el as HTMLElement).id;
        if (id) {
          const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (label) return textOf(label);
        }
        const parentLabel = el.closest("label");
        if (parentLabel) return textOf(parentLabel);
        return "";
      };

      const getFieldHint = (el: Element): string => {
        const ariaLabel = (el as HTMLElement).getAttribute("aria-label") || "";
        const ariaLabelledBy = (el as HTMLElement).getAttribute("aria-labelledby") || "";
        const labelledText = ariaLabelledBy
          ? ariaLabelledBy
              .split(" ")
              .map((id) => document.getElementById(id))
              .map((node) => textOf(node))
              .join(" ")
          : "";
        const placeholder = (el as HTMLInputElement).placeholder || "";
        const name = (el as HTMLInputElement).name || "";
        const label = closestLabel(el);
        return [label, ariaLabel, placeholder, name]
          .concat(labelledText)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .join(" ");
      };

      const normalize = (value: string) => value.toLowerCase();

      const matchField = (hint: string): { field: string | null; confidence: number } => {
        const text = normalize(hint);
        const tests: Array<{ field: string; keywords: string[]; confidence: number }> = [
          { field: "fullName", keywords: ["full name", "legal name"], confidence: 0.85 },
          { field: "email", keywords: ["email", "e-mail"], confidence: 0.9 },
          { field: "phone", keywords: ["phone", "mobile", "telephone"], confidence: 0.9 },
          { field: "location", keywords: ["city", "location"], confidence: 0.75 },
          { field: "workAuthorization", keywords: ["work authorization", "authorized to work"], confidence: 0.7 },
          { field: "gender", keywords: ["gender"], confidence: 0.8 },
          { field: "raceEthnicity", keywords: ["race", "ethnicity"], confidence: 0.8 },
          { field: "veteranStatus", keywords: ["veteran"], confidence: 0.8 },
          { field: "disabilityStatus", keywords: ["disability"], confidence: 0.8 },
        ];

        for (const test of tests) {
          if (test.keywords.some((keyword) => text.includes(keyword))) {
            return { field: test.field, confidence: test.confidence };
          }
        }

        return { field: null, confidence: 0 };
      };

      const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
      for (const input of inputs) {
        const element = input as HTMLInputElement;
        const type = (element.getAttribute("type") || "text").toLowerCase();
        if (type === "hidden") {
          continue;
        }

        if (type === "file") {
          element.setAttribute("data-autoapply-file", "resume");
          fileInputFound = true;
          continue;
        }

        const hint = getFieldHint(element);
        if (!hint) {
          skipped.push({ field: "unknown", reason: "no hint" });
          continue;
        }

        const { field, confidence } = matchField(hint);
        if (!field || confidence < 0.7) {
          skipped.push({ field: field || "unknown", reason: "low confidence" });
          continue;
        }

        const value = data[field];
        if (!value) {
          skipped.push({ field, reason: "no data" });
          continue;
        }

        if (element.value && element.value.trim().length > 0) {
          skipped.push({ field, reason: "already filled" });
          continue;
        }

        if (element.tagName.toLowerCase() === "select") {
          const select = element as unknown as HTMLSelectElement;
          const options = Array.from(select.options);
          const match = options.find((option) =>
            option.textContent?.toLowerCase().includes(String(value).toLowerCase())
          );
          if (match) {
            select.value = match.value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
            filled.push({ field });
          } else {
            skipped.push({ field, reason: "no matching option" });
          }
          continue;
        }

        if (type === "radio" || type === "checkbox") {
          skipped.push({ field, reason: "unsupported input type" });
          continue;
        }

        element.value = String(value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        filled.push({ field });
      }

      return { filled, skipped, fileInputFound };
    }, mapProfile(profile));

    const reasonCounts = result.skipped.reduce<Record<string, number>>((acc, entry) => {
      const reason = entry.reason ?? "unknown";
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

    this.logger.info(`Filled fields: ${result.filled.length}. Skipped: ${result.skipped.length}.`);
    if (result.skipped.length > 0) {
      this.logger.warn(`Skip reasons: ${JSON.stringify(reasonCounts)}`);
    }
    result.filled.forEach((entry) => {
      meta.runLogger.logEvent({
        runId: meta.runId,
        listingId: meta.listingId,
        applyType: meta.applyType,
        step: "field-filled",
        field: entry.field,
        timestamp: new Date().toISOString(),
      });
    });
    result.skipped.forEach((entry) => {
      meta.runLogger.logEvent({
        runId: meta.runId,
        listingId: meta.listingId,
        applyType: meta.applyType,
        step: "field-skipped",
        field: entry.field,
        reason: entry.reason,
        timestamp: new Date().toISOString(),
      });
    });

    await this.captureStep(page, meta, "after-fill");
    if (!result.fileInputFound) {
      this.logger.warn("No resume file input found in apply flow.");
    } else {
      await this.uploadResume(page, resume, meta);
    }
  }

  async answerScreening(page: AutomationPage, profile: UserProfile, meta: FormMeta): Promise<void> {
    this.logger.info("Attempting to advance through apply steps (dry-run)");

    for (let step = 0; step < MAX_STEPS; step += 1) {
      await this.captureStep(page, meta, `before-advance-${step + 1}`);
      const action = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, a")) as HTMLElement[];
        const getText = (el: HTMLElement) => el.textContent?.trim().toLowerCase() || "";

        const isSubmit = (text: string) =>
          text.includes("submit") || text.includes("finish") || text.includes("apply now") || text.includes("apply");
        const isNext = (text: string) =>
          text.includes("next") || text.includes("continue") || text.includes("review") || text.includes("save");

        const nextButton = buttons.find((btn) => {
          const text = getText(btn);
          return isNext(text) && !isSubmit(text);
        });

        if (!nextButton) {
          return { clicked: false, reason: "no next button" };
        }

        nextButton.setAttribute("data-autoapply-next", "true");
        return { clicked: true, selector: "[data-autoapply-next=\"true\"]" };
      });

      if (!action.clicked) {
        this.logger.info(`No further step buttons found (${action.reason}).`);
        return;
      }

      if (!action.selector) {
        this.logger.warn("Step advance selector missing.");
        return;
      }

      await page.click(action.selector);
      this.logger.info("Advanced to next step (dry-run)");
      meta.runLogger.logEvent({
        runId: meta.runId,
        listingId: meta.listingId,
        applyType: meta.applyType,
        step: "advance-step",
        reason: `step-${step + 1}`,
        timestamp: new Date().toISOString(),
      });
    }

    this.logger.warn("Max steps reached without submit (dry-run)." );
    void profile; // keep signature stable for future use
  }

  async detectSubmitState(page: AutomationPage, meta: FormMeta): Promise<SubmitDetection> {
    this.logger.info("Detecting submit readiness");
    await this.captureStep(page, meta, "before-submit-detect");

    const detection = await page.evaluate(() => {
      const getText = (el: Element) => el.textContent?.trim().toLowerCase() || "";
      const buttons = Array.from(document.querySelectorAll("button, [role=\"button\"], input[type=\"submit\"]"));
      const submitButtons = buttons.filter((el) => {
        const text = getText(el);
        const aria = (el as HTMLElement).getAttribute("aria-label")?.toLowerCase() || "";
        return (
          text.includes("submit") ||
          text.includes("apply now") ||
          text.includes("finish") ||
          aria.includes("submit") ||
          aria.includes("apply")
        );
      });
      const submitButton = buttons.find((el) => {
        const text = getText(el);
        const aria = (el as HTMLElement).getAttribute("aria-label")?.toLowerCase() || "";
        return (
          text.includes("submit") ||
          text.includes("apply now") ||
          text.includes("finish") ||
          aria.includes("submit") ||
          aria.includes("apply")
        );
      });

      const requiredMissing =
        document.querySelectorAll("[aria-invalid=\"true\"]").length > 0 ||
        document.querySelectorAll("[required]:not([value])").length > 0;

      const hasCaptcha =
        document.querySelectorAll("iframe[src*='captcha'], iframe[src*='recaptcha'], div[class*='captcha']").length > 0;

      const errorBanner =
        document.querySelectorAll("[data-testid*='error'], .icl-Alert--danger, .error").length > 0;

      if (hasCaptcha) {
        return {
          state: "blocked",
          reason: "captcha detected",
          submitButtonCount: submitButtons.length,
          hasCaptcha,
          errorBanner,
          requiredMissing,
        } as const;
      }

      if (errorBanner) {
        return {
          state: "blocked",
          reason: "error banner detected",
          submitButtonCount: submitButtons.length,
          hasCaptcha,
          errorBanner,
          requiredMissing,
        } as const;
      }

      if (requiredMissing) {
        return {
          state: "incomplete",
          reason: "missing required fields",
          submitButtonCount: submitButtons.length,
          hasCaptcha,
          errorBanner,
          requiredMissing,
        } as const;
      }

      if (submitButton) {
        return {
          state: "ready-to-submit",
          reason: "submit button detected",
          submitButtonCount: submitButtons.length,
          hasCaptcha,
          errorBanner,
          requiredMissing,
        } as const;
      }

      return {
        state: "blocked",
        reason: "submit action not found",
        submitButtonCount: submitButtons.length,
        hasCaptcha,
        errorBanner,
        requiredMissing,
      } as const;
    });

    const screenshotPath = await this.captureStep(page, meta, "after-submit-detect");
    const policy = evaluateSubmitPolicy(detection);
    meta.runLogger.logEvent({
      runId: meta.runId,
      listingId: meta.listingId,
      applyType: meta.applyType,
      step: "submit-detect",
      reason: detection.reason,
      status: detection.state,
      submitPolicy: policy.outcome,
      submitPolicyReason: policy.reason,
      timestamp: new Date().toISOString(),
      screenshotPath,
    });
    meta.runLogger.logEvent({
      runId: meta.runId,
      listingId: meta.listingId,
      applyType: meta.applyType,
      step: "submit-policy",
      status: policy.outcome,
      reason: policy.reason,
      submitPolicy: policy.outcome,
      submitPolicyReason: policy.reason,
      timestamp: new Date().toISOString(),
      screenshotPath,
    });

    return {
      state: detection.state,
      reason: detection.reason,
      submitPolicy: policy.outcome,
      submitPolicyReason: policy.reason,
      screenshotPath,
    };
  }

  private async uploadResume(page: AutomationPage, resume: ResumeAsset, meta: FormMeta): Promise<void> {
    const selector = await page.evaluate(() => {
      const input = document.querySelector("input[type=file][data-autoapply-file=\"resume\"]") as HTMLInputElement | null;
      if (!input) {
        return null;
      }
      return "input[type=file][data-autoapply-file=\"resume\"]";
    });

    if (!selector) {
      this.logger.warn("Resume file input missing after tagging.");
      return;
    }

    await page.uploadFile(selector, resume.path);
    this.logger.info("Resume uploaded to file input.");
    meta.runLogger.logEvent({
      runId: meta.runId,
      listingId: meta.listingId,
      applyType: meta.applyType,
      step: "resume-upload",
      field: resume.label,
      timestamp: new Date().toISOString(),
    });
  }

  private async captureStep(page: AutomationPage, meta: FormMeta, step: string): Promise<string> {
    const filename = `apply_${meta.listingId}_${step}.png`;
    const sanitized = filename.replace(/[^a-zA-Z0-9_.-]+/g, "-");
    const screenshotPath = path.join(meta.logDir, sanitized);
    await page.screenshot(screenshotPath);
    meta.setLastScreenshot(screenshotPath);
    meta.runLogger.logEvent({
      runId: meta.runId,
      listingId: meta.listingId,
      applyType: meta.applyType,
      step,
      timestamp: new Date().toISOString(),
      screenshotPath,
    });
    return screenshotPath;
  }
}

function mapProfile(profile: UserProfile): Record<string, string> {
  return {
    fullName: profile.fullName || "",
    email: profile.email || "",
    phone: profile.phone || "",
    location: profile.location || "",
    workAuthorization: profile.workAuthorization || "",
    gender: profile.eeo?.gender || "",
    raceEthnicity: profile.eeo?.raceEthnicity || "",
    veteranStatus: profile.eeo?.veteranStatus || "",
    disabilityStatus: profile.eeo?.disabilityStatus || "",
  };
}

function evaluateSubmitPolicy(detection: {
  state: string;
  submitButtonCount: number;
  hasCaptcha: boolean;
  errorBanner: boolean;
  requiredMissing: boolean;
}): { outcome: "pass" | "fail"; reason: string } {
  if (detection.hasCaptcha) {
    return { outcome: "fail", reason: "captcha detected" };
  }

  if (detection.errorBanner) {
    return { outcome: "fail", reason: "error banner detected" };
  }

  if (detection.requiredMissing) {
    return { outcome: "fail", reason: "missing required fields" };
  }

  if (detection.submitButtonCount !== 1) {
    return { outcome: "fail", reason: "submit button count not equal to 1" };
  }

  if (detection.state !== "ready-to-submit") {
    return { outcome: "fail", reason: "not ready to submit" };
  }

  return { outcome: "pass", reason: "all submit guards passed" };
}

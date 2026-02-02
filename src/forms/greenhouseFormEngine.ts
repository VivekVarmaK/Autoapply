import fs from "fs";
import path from "path";
import { AutomationPage } from "../automation/session";
import { ResumeAsset, UserProfile } from "../types/context";
import { FormEngine, FormMeta, SubmitDetection } from "./engine";
import { Logger } from "../logging";
import readline from "readline";

const MAX_STEPS = 3;

export class GreenhouseFormEngine implements FormEngine {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async mapAndFill(page: AutomationPage, profile: UserProfile, resume: ResumeAsset, meta: FormMeta): Promise<void> {
    this.logger.info("Mapping fields in Greenhouse apply form");
    await this.captureStep(page, meta, "before-fill");

    const result = await page.evaluate((data) => {
      type FieldFill = { field: string; reason?: string; hint?: string; selector?: string };
      const filled: FieldFill[] = [];
      const skipped: FieldFill[] = [];
      const longform: FieldFill[] = [];
      let fileInputFound = false;
      let captchaDetected = false;

      const textOf = (el: Element | null | undefined): string => el?.textContent?.trim() || "";

      const closestLabel = (el: Element): string => {
        const id = (el as HTMLElement).id;
        if (id) {
          const label = document.querySelector(`label[for=\"${CSS.escape(id)}\"]`);
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
        const id = (el as HTMLElement).id || "";
        const label = closestLabel(el);
        return [label, ariaLabel, placeholder, name, id]
          .concat(labelledText)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .join(" ");
      };

      const normalize = (value: string) => value.toLowerCase();

      const matchField = (hint: string): { field: string | null; confidence: number } => {
        const text = normalize(hint);
        if (text.includes("first name") || text.includes("given name")) {
          return { field: "firstName", confidence: 0.9 };
        }
        if (text.includes("last name") || text.includes("surname") || text.includes("family name")) {
          return { field: "lastName", confidence: 0.9 };
        }
        if (text.includes("full name")) {
          return { field: "fullName", confidence: 0.9 };
        }
        if (text.includes("email") || text.includes("e-mail")) {
          return { field: "email", confidence: 0.9 };
        }
        if (text.includes("phone") || text.includes("mobile") || text.includes("telephone")) {
          return { field: "phone", confidence: 0.9 };
        }
        if (text.includes("city") || text.includes("location") || text.includes("address")) {
          return { field: "location", confidence: 0.7 };
        }
        if (text.includes("work authorization") || text.includes("authorized to work")) {
          return { field: "workAuthorization", confidence: 0.7 };
        }
        if (text.includes("require sponsorship") || text.includes("sponsorship")) {
          return { field: "sponsorship", confidence: 0.8 };
        }
        if (text.includes("worked at instacart") || text.includes("previously worked")) {
          return { field: "priorEmployment", confidence: 0.8 };
        }
        if (text.includes("how did you hear") || text.includes("hear about this job")) {
          return { field: "referralSource", confidence: 0.8 };
        }
        if (text.includes("which state") || text.includes("state or province")) {
          return { field: "state", confidence: 0.8 };
        }
        if (text.includes("gender")) {
          return { field: "gender", confidence: 0.8 };
        }
        if (text.includes("lgbt") || text.includes("lgbtq")) {
          return { field: "lgbtq", confidence: 0.8 };
        }
        if (text.includes("race") || text.includes("ethnicity")) {
          return { field: "raceEthnicity", confidence: 0.8 };
        }
        if (text.includes("veteran")) {
          return { field: "veteranStatus", confidence: 0.8 };
        }
        if (text.includes("disability")) {
          return { field: "disabilityStatus", confidence: 0.8 };
        }
        if (text.includes("linkedin")) {
          return { field: "linkedin", confidence: 0.8 };
        }
        if (text.includes("portfolio") || text.includes("website") || text.includes("personal site")) {
          return { field: "website", confidence: 0.8 };
        }
        if (text.includes("github")) {
          return { field: "github", confidence: 0.8 };
        }
        if (text === "name" || text.includes(" name")) {
          return { field: "fullName", confidence: 0.7 };
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

        const hint = getFieldHint(element);
        const hintText = normalize(hint);
        if (type === "submit" || hintText.includes("submit_app") || hintText.includes("submit application")) {
          skipped.push({ field: "submit", reason: "submit-control", hint });
          continue;
        }
        if (hintText.includes("g-recaptcha") || hintText.includes("recaptcha") || hintText.includes("security code")) {
          captchaDetected = true;
          skipped.push({ field: "captcha", reason: "captcha", hint });
          continue;
        }
        if (hintText.includes("resume_text") || hintText.includes("cover_letter_text") || element.tagName.toLowerCase() === "textarea") {
          const marker = `autoapply-longform-${Math.random().toString(36).slice(2)}`;
          element.setAttribute("data-autoapply-longform", marker);
          longform.push({ field: "longform", reason: "needs-answer", hint, selector: `[data-autoapply-longform='${marker}']` });
          continue;
        }

        if (type === "file") {
          element.setAttribute("data-autoapply-file", "resume");
          fileInputFound = true;
          continue;
        }

        if (!hint) {
          skipped.push({ field: "unknown", reason: "no hint", hint });
          continue;
        }

        const { field, confidence } = matchField(hint);
        if (!field || confidence < 0.7) {
          skipped.push({ field: field || "unknown", reason: "low confidence", hint });
          continue;
        }

        const value = data[field];
        if (!value) {
          skipped.push({ field, reason: "no data", hint });
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
            skipped.push({ field, reason: "no matching option", hint });
          }
          continue;
        }

        if (type === "radio" || type === "checkbox") {
          const labelText = normalize(closestLabel(element) || "");
          const valueText = normalize((element as HTMLInputElement).value || "");
          const candidate = `${labelText} ${valueText}`.trim();
          const findQuestionText = (el: Element): string => {
            const fieldset = el.closest("fieldset");
            if (fieldset) {
              const legend = fieldset.querySelector("legend");
              if (legend) return normalize(legend.textContent || "");
            }
            const ariaLabel = (el as HTMLElement).getAttribute("aria-label") || "";
            if (ariaLabel) return normalize(ariaLabel);
            const ariaLabelledBy = (el as HTMLElement).getAttribute("aria-labelledby") || "";
            if (ariaLabelledBy) {
              return normalize(
                ariaLabelledBy
                  .split(" ")
                  .map((id) => document.getElementById(id))
                  .map((node) => (node?.textContent || "").trim())
                  .join(" ")
              );
            }
            return "";
          };
          const questionText = findQuestionText(element);
          let targetField = field;
          let targetValue = normalize(String(value));

          if (targetField === "unknown" || !targetField) {
            if (
              questionText.includes("gender") ||
              candidate.includes("woman") ||
              candidate.includes("man") ||
              candidate.includes("non binary") ||
              candidate.includes("non-conforming")
            ) {
              targetField = "gender";
              targetValue = normalize(String(data["gender"] || ""));
            } else if (
              questionText.includes("lgbt") ||
              questionText.includes("lgbtq") ||
              questionText.includes("lgbt2qia") ||
              questionText.includes("community")
            ) {
              targetField = "lgbtq";
              targetValue = normalize(String(data["lgbtq"] || ""));
            } else if (
              questionText.includes("race") ||
              questionText.includes("ethnicity") ||
              candidate.includes("asian") ||
              candidate.includes("black") ||
              candidate.includes("white") ||
              candidate.includes("hispanic") ||
              candidate.includes("latinx") ||
              candidate.includes("native hawaiian") ||
              candidate.includes("pacific islander") ||
              candidate.includes("indigenous")
            ) {
              targetField = "raceEthnicity";
              targetValue = normalize(String(data["raceEthnicity"] || ""));
            } else if (candidate.includes("veteran")) {
              targetField = "veteranStatus";
              targetValue = normalize(String(data["veteranStatus"] || ""));
            } else if (candidate.includes("disability")) {
              targetField = "disabilityStatus";
              targetValue = normalize(String(data["disabilityStatus"] || ""));
            }
          }

          if (!targetField || !targetValue) {
            skipped.push({ field: field || "unknown", reason: "unsupported input type", hint });
            continue;
          }

          const matchesEeOption = (fieldName: string) => {
            const target = targetValue;
            if (!target) return false;
            if (candidate.includes("i don't wish to answer") || candidate.includes("not listed")) {
              return false;
            }
            if (fieldName === "gender") {
              if (target.includes("female")) return candidate.includes("woman") || candidate.includes("female");
              if (target.includes("male")) return candidate.includes("man") || candidate.includes("male");
              if (target.includes("non")) return candidate.includes("non binary") || candidate.includes("non-conforming");
              return false;
            }
            if (fieldName === "raceEthnicity") {
              if (target.includes("asian")) return candidate.includes("asian");
              if (target.includes("black")) return candidate.includes("black");
              if (target.includes("white")) return candidate.includes("white");
              if (target.includes("hispanic") || target.includes("latinx")) return candidate.includes("hispanic") || candidate.includes("latinx");
              if (target.includes("native hawaiian") || target.includes("pacific")) return candidate.includes("pacific");
              if (target.includes("indigenous")) return candidate.includes("indigenous") || candidate.includes("native");
              return candidate.includes(target);
            }
            if (fieldName === "veteranStatus") {
              if (target.includes("not")) return candidate.includes("not a protected veteran") || candidate.includes("not a veteran");
              return candidate.includes("protected veteran") || candidate.includes("veteran");
            }
            if (fieldName === "disabilityStatus") {
              if (target.includes("not")) return candidate.includes("no, i don't have a disability");
              return candidate.includes("yes, i have a disability");
            }
            if (fieldName === "lgbtq") {
              if (target.includes("yes")) return candidate === "yes" || candidate.includes("yes");
              if (target.includes("no")) return candidate === "no" || candidate.includes("no");
              return false;
            }
            return candidate.includes(target);
          };

          if (matchesEeOption(targetField)) {
            (element as HTMLInputElement).checked = true;
            element.dispatchEvent(new Event("change", { bubbles: true }));
            filled.push({ field: targetField });
          } else {
            skipped.push({ field: targetField || field, reason: "unsupported input type", hint });
          }
          continue;
        }

        if (element.value && element.value.trim().length > 0) {
          skipped.push({ field, reason: "already filled", hint });
          continue;
        }

        element.value = String(value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        filled.push({ field });
      }

      return { filled, skipped, longform, fileInputFound, captchaDetected };
    }, mapProfile(profile));

    const longformResults = await this.fillLongform(page, result.longform, profile, meta);
    const allFilled = result.filled.concat(longformResults.filled);
    const allSkipped = result.skipped.concat(longformResults.skipped);

    const reasonCounts = allSkipped.reduce<Record<string, number>>((acc, entry) => {
      const reason = entry.reason ?? "unknown";
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

    this.logger.info(`Filled fields: ${allFilled.length}. Skipped: ${allSkipped.length}.`);
    if (result.skipped.length > 0) {
      this.logger.warn(`Skip reasons: ${JSON.stringify(reasonCounts)}`);
    }
    allFilled.forEach((entry) => {
      meta.runLogger.logEvent({
        runId: meta.runId,
        listingId: meta.listingId,
        applyType: meta.applyType,
        step: "field-filled",
        field: entry.field,
        timestamp: new Date().toISOString(),
      });
    });
    allSkipped.forEach((entry) => {
      meta.runLogger.logEvent({
        runId: meta.runId,
        listingId: meta.listingId,
        applyType: meta.applyType,
        step: "field-skipped",
        field: entry.field,
        reason: entry.reason,
        hint: entry.hint,
        timestamp: new Date().toISOString(),
      });
    });

    const missing = allSkipped.filter((entry) =>
      ["no data", "missing-answer", "low confidence", "not-supported", "needs-answer"].includes(
        entry.reason ?? ""
      )
    );
    if (missing.length > 0) {
      this.recordMissingFields(meta, missing);
      meta.runLogger.logEvent({
        runId: meta.runId,
        listingId: meta.listingId,
        applyType: meta.applyType,
        step: "missing-fields",
        reason: `${missing.length} missing fields`,
        timestamp: new Date().toISOString(),
      });
    }

    await this.captureStep(page, meta, "after-fill");
    if (!result.fileInputFound) {
      this.logger.warn("No resume file input found in apply form.");
    } else {
      await this.uploadResume(page, resume, meta);
    }

    if (result.captchaDetected && meta.pauseOnVerification) {
      meta.runLogger.logEvent({
        runId: meta.runId,
        listingId: meta.listingId,
        applyType: meta.applyType,
        step: "pause-verification",
        reason: "captcha detected",
        timestamp: new Date().toISOString(),
      });
      this.logger.warn("Verification detected. Complete it in the browser, then press Enter to continue...");
      await waitForEnter();
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
          text.includes("submit") || text.includes("finish") || text.includes("apply");
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
    void profile;
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

      const requiredMissing =
        document.querySelectorAll("[aria-invalid=\"true\"]").length > 0 ||
        document.querySelectorAll("[required]:not([value])").length > 0;

      const hasCaptcha =
        document.querySelectorAll("iframe[src*='captcha'], iframe[src*='recaptcha'], div[class*='captcha']").length > 0;

      const errorBanner =
        document.querySelectorAll("[data-testid*='error'], .icl-Alert--danger, .error").length > 0;

      return {
        submitButtonCount: submitButtons.length,
        hasCaptcha,
        errorBanner,
        requiredMissing,
      } as const;
    });

    let state: SubmitDetection["state"] = "blocked";
    let reason = "submit action not found";
    if (detection.hasCaptcha) {
      state = "blocked";
      reason = "captcha detected";
    } else if (detection.errorBanner) {
      state = "blocked";
      reason = "error banner detected";
    } else if (detection.requiredMissing) {
      state = "incomplete";
      reason = "missing required fields";
    } else if (detection.submitButtonCount > 0) {
      state = "ready-to-submit";
      reason = "submit button detected";
    }

    const policy = evaluateSubmitPolicy({
      state,
      submitButtonCount: detection.submitButtonCount,
      hasCaptcha: detection.hasCaptcha,
      errorBanner: detection.errorBanner,
      requiredMissing: detection.requiredMissing,
    });

    const screenshotPath = await this.captureStep(page, meta, "after-submit-detect");
    meta.runLogger.logEvent({
      runId: meta.runId,
      listingId: meta.listingId,
      applyType: meta.applyType,
      step: "submit-detect",
      reason,
      status: state,
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

    return { state, reason, submitPolicy: policy.outcome, submitPolicyReason: policy.reason, screenshotPath };
  }

  private recordMissingFields(meta: FormMeta, missing: Array<{ field: string; reason?: string; hint?: string }>): void {
    if (!meta.dataDir) {
      return;
    }
    const filePath = path.join(meta.dataDir, "missing_fields.json");
    const payload = {
      runId: meta.runId,
      listingId: meta.listingId,
      applyType: meta.applyType,
      timestamp: new Date().toISOString(),
      missing,
    };
    try {
      const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : [];
      const next = Array.isArray(existing) ? existing.concat(payload) : [payload];
      fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
    } catch (error) {
      this.logger.warn("Failed to persist missing fields.");
    }
  }

  private async fillLongform(
    page: AutomationPage,
    entries: Array<{ field: string; reason?: string; hint?: string; selector?: string }>,
    profile: UserProfile,
    meta: FormMeta
  ): Promise<{ filled: Array<{ field: string; reason?: string }>; skipped: Array<{ field: string; reason?: string; hint?: string }> }>
  {
    const filled: Array<{ field: string; reason?: string }> = [];
    const skipped: Array<{ field: string; reason?: string; hint?: string }> = [];
    if (!entries || entries.length === 0) {
      return { filled, skipped };
    }

    for (const entry of entries) {
      const selector = entry.selector;
      if (!selector || !entry.hint) {
        skipped.push({ field: "longform", reason: "missing-selector", hint: entry.hint });
        continue;
      }

      const key = classifyLongformKey(entry.hint);
      let answer = getAnswer(profile.answers ?? {}, key);
      let reason = "answer";

      if (!answer && meta.generateLongform) {
        answer = await meta.generateLongform({ question: entry.hint, profile });
        if (answer) {
          reason = "generated";
          if (meta.persistAnswer) {
            meta.persistAnswer(key, answer);
          }
          profile.answers = { ...(profile.answers ?? {}), [key]: answer };
        }
      }

      if (!answer) {
        skipped.push({ field: "longform", reason: "missing-answer", hint: entry.hint });
        continue;
      }

      await page.fill(selector, answer);
      filled.push({ field: "longform", reason });
    }

    return { filled, skipped };
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

async function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });
}

function mapProfile(profile: UserProfile): Record<string, unknown> {
  const nameParts = (profile.fullName || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
  return {
    fullName: profile.fullName || "",
    firstName,
    lastName,
    email: profile.email || "",
    phone: profile.phone || "",
    location: profile.location || "",
    workAuthorization: profile.workAuthorization || "",
    sponsorship: profile.sponsorship || "",
    priorEmployment: profile.priorEmployment || "",
    referralSource: profile.referralSource || "",
    state: profile.state || "",
    linkedin: (profile as any).linkedin || "",
    website: (profile as any).website || "",
    github: (profile as any).github || "",
    gender: profile.eeo?.gender || "",
    lgbtq: profile.eeo?.lgbtq || "",
    raceEthnicity: profile.eeo?.raceEthnicity || "",
    veteranStatus: profile.eeo?.veteranStatus || "",
    disabilityStatus: profile.eeo?.disabilityStatus || "",
    answers: profile.answers || {},
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

function classifyLongformKey(hint: string): string {
  const text = hint.toLowerCase();
  if (text.includes("cover letter")) {
    return "coverLetter";
  }
  if (text.includes("why") || text.includes("interested") || text.includes("motivat")) {
    return "whyCompany";
  }
  if (text.includes("role") || text.includes("position")) {
    return "whyRole";
  }
  if (text.includes("additional") || text.includes("anything else")) {
    return "additionalInfo";
  }
  return "longformDefault";
}

function getAnswer(answers: Record<string, string>, key: string): string {
  const direct = answers[key];
  if (direct) return direct;
  const snake = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
  if (answers[snake]) return answers[snake];
  if (key === "coverLetter" && answers.cover_letter) return answers.cover_letter;
  if (key === "whyCompany" && answers.why_company) return answers.why_company;
  if (key === "whyRole" && answers.why_role) return answers.why_role;
  if (key === "additionalInfo" && answers.additional_info) return answers.additional_info;
  if (key === "longformDefault" && answers.longform_default) return answers.longform_default;
  return "";
}

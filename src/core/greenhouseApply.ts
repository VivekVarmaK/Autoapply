import path from "path";
import { FileJobStore } from "../storage/jobStore";
import { JobRecord } from "../types/jobs";
import { ApplyResult } from "../types/boards";
import { ApplyContext } from "../types/context";
import { JobRepo } from "../storage/repositories";

export interface GreenhouseApplyOptions {
  limit: number;
  jobRepo?: JobRepo;
}

export interface GreenhouseApplySummary {
  attempted: number;
  results: ApplyResult[];
}

export async function runGreenhouseDryRun(
  ctx: ApplyContext,
  options: GreenhouseApplyOptions
): Promise<GreenhouseApplySummary> {
  const store = new FileJobStore(ctx.dataDir, "filtered_jobs.json");
  const allJobs = await store.loadAll();
  const jobs = allJobs.filter((job) => job.ats === "greenhouse").slice(0, options.limit);
  const results: ApplyResult[] = [];

  for (const job of jobs) {
    const result = await applyGreenhouseJob(job, ctx, options.jobRepo);
    results.push(result);
  }

  return { attempted: jobs.length, results };
}

export async function runGreenhouseDryRunForJobs(
  ctx: ApplyContext,
  jobs: JobRecord[],
  jobRepo?: JobRepo
): Promise<GreenhouseApplySummary> {
  const results: ApplyResult[] = [];
  for (const job of jobs) {
    const result = await applyGreenhouseJob(job, ctx, jobRepo);
    results.push(result);
  }
  return { attempted: jobs.length, results };
}

async function applyGreenhouseJob(job: JobRecord, ctx: ApplyContext, jobRepo?: JobRepo): Promise<ApplyResult> {
  const repoListing = {
    id: job.id,
    board: "greenhouse",
    url: job.applyUrl,
    title: job.title,
    company: job.company,
    location: job.location,
  };

  if (jobRepo && (await jobRepo.hasApplied(job.applyUrl))) {
    return {
      listingId: job.id,
      status: "skipped",
      message: "Already applied (persisted)",
    };
  }

  const page = await ctx.automation.newPage();
  let activePage: any = page;
  let extraPage: any = null;
  try {
    await activePage.goto(job.applyUrl);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    ctx.runLogger.logEvent({
      runId: ctx.runId,
      listingId: job.id,
      applyType: "greenhouse",
      step: "attempt",
      title: job.title,
      company: job.company,
      timestamp: new Date().toISOString(),
    });

    await activePage.evaluate(() => {
      window.scrollTo(0, 0);
    });
    let applyTarget = await waitForApplyTarget(activePage, 8000);
    if (!applyTarget) {
      await scrollToBottom(activePage);
      applyTarget = await waitForApplyTarget(activePage, 8000);
    }

    if (applyTarget) {
      const { page: applyPage, path: applyPath } = await clickApplyTarget(activePage, applyTarget);
      if (applyPage && applyPage !== activePage) {
        extraPage = activePage;
        activePage = applyPage;
      }
      ctx.runLogger.logEvent({
        runId: ctx.runId,
        listingId: job.id,
        applyType: "greenhouse",
        step: "cta-click",
        reason: applyPath,
        timestamp: new Date().toISOString(),
      });
      await waitForForm(activePage);
    } else {
      let ctaTarget = await findApplyCtaSelector(activePage);
      if (!ctaTarget) {
        await scrollToBottom(activePage);
        ctaTarget = await findApplyCtaSelector(activePage);
      }
      if (ctaTarget) {
        const { page: applyPage, path: applyPath } = await clickApplyTarget(activePage, ctaTarget);
        if (applyPage && applyPage !== activePage) {
          extraPage = activePage;
          activePage = applyPage;
        }
        ctx.runLogger.logEvent({
          runId: ctx.runId,
          listingId: job.id,
          applyType: "greenhouse",
          step: "cta-click",
          reason: applyPath,
          timestamp: new Date().toISOString(),
        });
        await waitForForm(activePage);
      }
      await logClickableInventory(activePage, ctx, job.id);
      await logFrameInventory(activePage, ctx, job.id);
      let formPresent = await isFormPresent(activePage);
      if (!formPresent) {
        const derivedUrl = await extractApplyUrl(activePage);
        if (derivedUrl) {
          ctx.runLogger.logEvent({
            runId: ctx.runId,
            listingId: job.id,
            applyType: "greenhouse",
            step: "derived-apply-url",
            reason: derivedUrl,
            timestamp: new Date().toISOString(),
          });
          await activePage.goto(derivedUrl);
          await waitForForm(activePage);
          formPresent = await isFormPresent(activePage);
        }
      }
      if (!formPresent) {
        const iframeUrl = await extractIframeApplyUrl(activePage);
        if (iframeUrl) {
          ctx.runLogger.logEvent({
            runId: ctx.runId,
            listingId: job.id,
            applyType: "greenhouse",
            step: "iframe-apply-url",
            reason: iframeUrl,
            timestamp: new Date().toISOString(),
          });
          await activePage.goto(iframeUrl);
          await waitForForm(activePage);
          formPresent = await isFormPresent(activePage);
        }
      }
      if (!formPresent && job.companySlug) {
        const fallbackUrl = `https://job-boards.greenhouse.io/${job.companySlug}/jobs/${job.id}`;
        ctx.runLogger.logEvent({
          runId: ctx.runId,
          listingId: job.id,
          applyType: "greenhouse",
          step: "fallback",
          reason: fallbackUrl,
          timestamp: new Date().toISOString(),
        });
        await activePage.goto(fallbackUrl);
        const finalUrl = await activePage.evaluate(() => window.location.href);
        ctx.runLogger.logEvent({
          runId: ctx.runId,
          listingId: job.id,
          applyType: "greenhouse",
          step: "fallback-final-url",
          reason: finalUrl,
          timestamp: new Date().toISOString(),
        });
        await waitForForm(activePage);
      }

      if (!formPresent) {
        const screenshotPath = await captureScreenshot(activePage, ctx, job.id, "no-apply-button");
        ctx.runLogger.logEvent({
          runId: ctx.runId,
          listingId: job.id,
          applyType: "greenhouse",
          step: "skip",
          status: "skipped",
          reason: "no apply button",
          timestamp: new Date().toISOString(),
          screenshotPath,
        });
        return {
          listingId: job.id,
          status: "skipped",
          message: "No apply button detected",
          artifacts: { screenshotPath },
        };
      }
    }

    const meta = {
      runId: ctx.runId,
      listingId: job.id,
      applyType: "greenhouse",
      logDir: ctx.logDir,
      dataDir: ctx.dataDir,
      runLogger: ctx.runLogger,
      setLastScreenshot: (pathValue: string) => {
        ctx.lastScreenshotPath = pathValue;
      },
      pauseOnVerification: ctx.pauseOnVerification,
    };

    await ctx.formEngine.mapAndFill(activePage, ctx.profile, ctx.resume, meta);
    await ctx.formEngine.answerScreening(activePage, ctx.profile, meta);
    const submitDetection = await ctx.formEngine.detectSubmitState(activePage, meta);

    if (!ctx.dryRun && submitDetection.submitPolicy === "pass" && submitDetection.state === "ready-to-submit") {
      const submitResult = await submitGreenhouseApplication(activePage, ctx, job.id);
      ctx.runLogger.logEvent({
        runId: ctx.runId,
        listingId: job.id,
        applyType: "greenhouse",
        step: "result",
        status: submitResult.status,
        reason: submitResult.message,
        timestamp: new Date().toISOString(),
        screenshotPath: submitResult.artifacts?.screenshotPath ?? ctx.lastScreenshotPath,
      });
      if (jobRepo) {
        await jobRepo.markApplied(repoListing as any, submitResult);
      }
      return submitResult;
    }

    ctx.runLogger.logEvent({
      runId: ctx.runId,
      listingId: job.id,
      applyType: "greenhouse",
      step: "result",
      status: "dry-run",
      reason: submitDetection.reason,
      timestamp: new Date().toISOString(),
      screenshotPath: submitDetection.screenshotPath ?? ctx.lastScreenshotPath,
    });

    const dryRunResult = {
      listingId: job.id,
      status: "dry-run" as const,
      message: `Dry-run: ${submitDetection.state} (${submitDetection.reason})`,
      artifacts: {
        screenshotPath: submitDetection.screenshotPath ?? ctx.lastScreenshotPath,
      },
    };
    if (jobRepo) {
      await jobRepo.markApplied(repoListing as any, dryRunResult);
    }
    return dryRunResult;
  } catch (error) {
    const screenshotPath = await captureScreenshot(activePage, ctx, job.id, "apply-error");
    ctx.runLogger.logEvent({
      runId: ctx.runId,
      listingId: job.id,
      applyType: "greenhouse",
      step: "error",
      status: "failed",
      reason: error instanceof Error ? error.message : "Apply failed",
      timestamp: new Date().toISOString(),
      screenshotPath,
    });
    return {
      listingId: job.id,
      status: "failed",
      message: error instanceof Error ? error.message : "Apply failed",
      artifacts: {
        screenshotPath,
      },
    };
  } finally {
    if (!ctx.keepOpen) {
      if (extraPage) {
        await extraPage.close().catch(() => undefined);
      }
      await activePage.close().catch(() => undefined);
    }
  }
}

async function submitGreenhouseApplication(
  page: any,
  ctx: ApplyContext,
  listingId: string
): Promise<ApplyResult> {
  const selector = await page.evaluate(() => {
    const getText = (el: Element) => el.textContent?.trim().toLowerCase() || "";
    const buttons = Array.from(document.querySelectorAll("button, [role=\"button\"], input[type=\"submit\"]"));
    const submit = buttons.find((el) => {
      const text = getText(el);
      const aria = (el as HTMLElement).getAttribute("aria-label")?.toLowerCase() || "";
      return text.includes("submit") || text.includes("apply now") || text.includes("finish") || aria.includes("submit");
    }) as HTMLElement | undefined;
    if (!submit) {
      return null;
    }
    submit.setAttribute("data-autoapply-submit", "true");
    return "[data-autoapply-submit=\"true\"]";
  });

  if (!selector) {
    const screenshotPath = await captureScreenshot(page, ctx, listingId, "submit-missing");
    return {
      listingId,
      status: "failed",
      message: "Submit button not found",
      artifacts: { screenshotPath },
    };
  }

  await page.click(selector);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const screenshotPath = await captureScreenshot(page, ctx, listingId, "submitted");
  ctx.runLogger.logEvent({
    runId: ctx.runId,
    listingId,
    applyType: "greenhouse",
    step: "submit-click",
    timestamp: new Date().toISOString(),
    screenshotPath,
  });

  return {
    listingId,
    status: "submitted",
    message: "Submitted",
    artifacts: { screenshotPath },
  };
}

async function evaluateApplyTarget(
  context: { evaluate: (fn: () => string | null) => Promise<string | null> }
): Promise<string | null> {
  return context.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("a, button, input[type=submit], input[type=button], [role=button]")
    ) as HTMLElement[];
    const getText = (el: HTMLElement) => {
      const text = el.textContent?.trim() || "";
      const aria = el.getAttribute("aria-label") || "";
      const title = el.getAttribute("title") || "";
      const value = (el as HTMLInputElement).value || "";
      const href = el.tagName.toLowerCase() === "a" ? (el as HTMLAnchorElement).href || "" : "";
      return `${text} ${aria} ${title} ${value} ${href}`.trim().toLowerCase();
    };
    const applyEl = candidates.find((el) => {
      const text = getText(el);
      return (
        text.includes("apply for this job") ||
        text.includes("apply to this job") ||
        text.includes("apply for the job") ||
        text.includes("apply for this position") ||
        text.includes("apply now") ||
        text.includes("apply today") ||
        text.includes("submit application") ||
        text.includes("submit your application") ||
        text.includes("job/?id=") ||
        text.includes("application") ||
        text === "apply"
      );
    });
    if (!applyEl) {
      return null;
    }
    applyEl.setAttribute("data-autoapply-apply", "true");
    return "[data-autoapply-apply=\"true\"]";
  });
}

async function waitForApplyTarget(
  page: { evaluate: (fn: () => string | null) => Promise<string | null> },
  timeoutMs: number
): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const selector = await evaluateApplyTarget(page);
    if (selector) {
      return selector;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function evaluateApplyCtaSelector(
  context: { evaluate: (fn: () => string | null) => Promise<string | null> }
): Promise<string | null> {
  return context.evaluate(() => {
    const clickableSelector = "a, button, input[type=submit], input[type=button], [role=button]";
    const candidates: HTMLElement[] = [];
    const collect = (root: ParentNode) => {
      const nodes = Array.from(root.querySelectorAll("*")) as HTMLElement[];
      for (const node of nodes) {
        candidates.push(node);
        const shadow = (node as any).shadowRoot as ShadowRoot | undefined;
        if (shadow) {
          collect(shadow);
        }
      }
    };
    collect(document);
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const matches = (value: string) =>
      value.includes("apply for this job") ||
      value.includes("apply to this job") ||
      value.includes("apply for the job") ||
      value.includes("apply for this position") ||
      value.includes("apply now") ||
      value.includes("apply today") ||
      value.includes("submit application") ||
      value.includes("submit your application") ||
      value.includes("job/?id=") ||
      value.includes("application") ||
      value === "apply";

    for (const el of candidates) {
      const text = normalize(el.textContent || "");
      const aria = normalize(el.getAttribute("aria-label") || "");
      const title = normalize(el.getAttribute("title") || "");
      const href = el.tagName.toLowerCase() === "a" ? (el as HTMLAnchorElement).href || "" : "";
      if (!matches(`${text} ${aria} ${title} ${href}`.trim())) {
        continue;
      }
      let target: HTMLElement | null = el;
      if (!(el.matches?.(clickableSelector) ?? false)) {
        target = el.closest(clickableSelector);
      }
      if (!target) {
        continue;
      }
      target.setAttribute("data-autoapply-cta", "true");
      return "[data-autoapply-cta=\"true\"]";
    }
    return null;
  });
}

async function findApplyCtaSelector(
  page: { evaluate: (fn: () => string | null) => Promise<string | null> }
): Promise<string | null> {
  return evaluateApplyCtaSelector(page);
}

async function clickApplyTarget(
  page: { clickWithOutcome: (selector: string) => Promise<{ page?: any; path: string }> },
  selector: string
): Promise<{ page?: any; path: string }> {
  return page.clickWithOutcome(selector);
}

async function waitForForm(page: { evaluate: (fn: () => boolean) => Promise<boolean> }): Promise<void> {
  const maxChecks = 20;
  for (let i = 0; i < maxChecks; i += 1) {
    const ready = await page.evaluate(() => {
      return Boolean(document.querySelector("form")) || Boolean(document.querySelector("input[type=file]"));
    });
    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function isFormPresent(page: { evaluate: (fn: () => boolean) => Promise<boolean> }): Promise<boolean> {
  return page.evaluate(() => {
    return Boolean(document.querySelector("form")) || Boolean(document.querySelector("input[type=file]"));
  });
}

async function scrollToBottom(page: { evaluate: (fn: () => void) => Promise<void> }): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

async function logClickableInventory(
  page: { evaluate: (fn: () => Array<{ tag: string; text: string; aria: string; title: string }>) => Promise<Array<{ tag: string; text: string; aria: string; title: string }>> },
  ctx: ApplyContext,
  listingId: string
): Promise<void> {
  const items = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("a, button, input[type=submit], input[type=button]")) as HTMLElement[];
    const normalize = (value: string) => value.replace(/\\s+/g, " ").trim();
    return elements
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: normalize(el.textContent || ""),
        aria: normalize(el.getAttribute("aria-label") || ""),
        title: normalize(el.getAttribute("title") || ""),
      }))
      .filter((item) => item.text || item.aria || item.title)
      .slice(0, 20);
  });

  ctx.runLogger.logEvent({
    runId: ctx.runId,
    listingId,
    applyType: "greenhouse",
    step: "clickable-inventory",
    reason: JSON.stringify(items),
    timestamp: new Date().toISOString(),
  });
}

async function extractApplyUrl(
  page: { evaluate: (fn: () => string | null) => Promise<string | null> }
): Promise<string | null> {
  return page.evaluate(() => {
    const urls = new Set<string>();
    const collectFromText = (text: string) => {
      const regex = /https?:\/\/[^\s"'<>]+/gi;
      let match: RegExpExecArray | null = null;
      while ((match = regex.exec(text))) {
        urls.add(match[0]);
      }
    };
    const scripts = Array.from(document.querySelectorAll("script")) as HTMLScriptElement[];
    for (const script of scripts) {
      const text = script.textContent || "";
      if (text) {
        collectFromText(text);
      }
    }
    const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
    for (const anchor of anchors) {
      if (anchor.href) {
        urls.add(anchor.href);
      }
    }
    const locationOrigin = window.location.origin;
    const candidates = Array.from(urls);
    const preferred = candidates.find((url) => {
      const lower = url.toLowerCase();
      return (
        lower.includes("job/?id=") ||
        lower.includes("apply") ||
        lower.includes("application") ||
        lower.includes("greenhouse.io") ||
        lower.includes("job-boards.greenhouse.io")
      );
    });
    if (preferred) {
      return preferred;
    }
    const sameOrigin = candidates.find((url) => url.startsWith(locationOrigin) && url.includes("job/?"));
    return sameOrigin ?? null;
  });
}

async function extractIframeApplyUrl(
  page: { evaluate: (fn: () => string | null) => Promise<string | null> }
): Promise<string | null> {
  return page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll("iframe")) as HTMLIFrameElement[];
    for (const frame of frames) {
      const src = frame.src || "";
      const lower = src.toLowerCase();
      if (
        lower.includes("greenhouse.io") ||
        lower.includes("job-boards.greenhouse.io") ||
        lower.includes("greenhouse")
      ) {
        return src;
      }
    }
    return null;
  });
}

async function logFrameInventory(
  page: { evaluate: (fn: () => Array<{ src: string; title: string }>) => Promise<Array<{ src: string; title: string }>> },
  ctx: ApplyContext,
  listingId: string
): Promise<void> {
  const frames = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll("iframe")) as HTMLIFrameElement[];
    return iframes.map((frame) => ({
      src: frame.src || "",
      title: frame.title || "",
    }));
  });
  ctx.runLogger.logEvent({
    runId: ctx.runId,
    listingId,
    applyType: "greenhouse",
    step: "frame-inventory",
    reason: JSON.stringify(frames.slice(0, 10)),
    timestamp: new Date().toISOString(),
  });
}

async function captureScreenshot(
  page: { screenshot: (p: string) => Promise<void> },
  ctx: ApplyContext,
  listingId: string,
  step: string
): Promise<string | undefined> {
  const filename = `apply_${listingId}_${step}.png`;
  const sanitized = filename.replace(/[^a-zA-Z0-9_.-]+/g, "-");
  const screenshotPath = path.join(ctx.logDir, sanitized);
  await page.screenshot(screenshotPath);
  ctx.lastScreenshotPath = screenshotPath;
  ctx.runLogger.logEvent({
    runId: ctx.runId,
    listingId,
    applyType: "greenhouse",
    step,
    timestamp: new Date().toISOString(),
    screenshotPath,
  });
  return screenshotPath;
}

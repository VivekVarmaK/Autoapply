import path from "path";
import { ApplyResult, BoardConnector, JobListing, SearchCriteria } from "../../types/boards";
import { ApplyContext } from "../../types/context";
import { AutomationSession, AutomationPage } from "../../automation/session";

export function createIndeedConnector(): BoardConnector {
  return {
    name: "indeed",
    async search(criteria: SearchCriteria, session: AutomationSession): Promise<JobListing[]> {
      const listings: JobListing[] = [];
      const seen = new Set<string>();

      const titles = criteria.titles.length > 0 ? criteria.titles : [""];
      const locations = criteria.locations.length > 0 ? criteria.locations : [""];
      const page = await session.newPage();

      for (const title of titles) {
        for (const location of locations) {
          const url = buildSearchUrl(title, location);
          await page.goto(url);
          await waitForManualVerification(page, "search");
          const pageListings = await scrapeListings(page);
          for (const listing of pageListings) {
            if (seen.has(listing.url)) {
              continue;
            }
            seen.add(listing.url);
            listings.push(listing);
          }
        }
      }

      return listings;
    },
    async apply(listing: JobListing, ctx: ApplyContext): Promise<ApplyResult> {
      const page = await ctx.automation.newPage();
      try {
        await page.goto(listing.url);
        await waitForManualVerification(page, "detail");
        ctx.runLogger.logEvent({
          runId: ctx.runId,
          listingId: listing.id,
          applyType: ctx.lastApplyType ?? "unknown",
          step: "attempt",
          title: listing.title,
          company: listing.company,
          timestamp: new Date().toISOString(),
        });

      const applyTarget = await markApplyTarget(page);
      if (!applyTarget) {
          ctx.lastApplyType = "none";
          const screenshotPath = await captureScreenshot(page, ctx, listing.id, "no-apply-button");
          ctx.runLogger.logEvent({
            runId: ctx.runId,
            listingId: listing.id,
            applyType: "none",
            step: "skip",
            status: "skipped",
            reason: "no apply button",
            timestamp: new Date().toISOString(),
            screenshotPath,
          });
          return {
            listingId: listing.id,
            status: "skipped",
            message: "No apply button detected (flow: none)",
            artifacts: {
              screenshotPath,
            },
          };
        }

      if (applyTarget.kind === "external") {
        ctx.lastApplyType = "external";
        const screenshotPath = await captureScreenshot(page, ctx, listing.id, "external-apply");
        ctx.runLogger.logEvent({
          runId: ctx.runId,
          listingId: listing.id,
          applyType: "external",
          step: "external-detected",
          status: "skipped",
          reason: applyTarget.ats ?? "external",
          externalUrl: applyTarget.href,
          externalAts: applyTarget.ats,
          timestamp: new Date().toISOString(),
          screenshotPath,
        });
        ctx.runLogger.logEvent({
          runId: ctx.runId,
          listingId: listing.id,
          applyType: "external",
          step: "skip",
          status: "skipped",
          reason: "external apply",
          externalUrl: applyTarget.href,
          externalAts: applyTarget.ats,
          timestamp: new Date().toISOString(),
          screenshotPath,
        });
        return {
          listingId: listing.id,
          status: "skipped",
          message: `Apply button leads to external site (${applyTarget.ats ?? "external"})`,
          artifacts: {
            screenshotPath,
          },
        };
      }

        try {
          await page.click(applyTarget.selector);
          const flow = await detectApplyFlow(page);
          ctx.lastApplyType = flow.type;
          ctx.runLogger.logEvent({
            runId: ctx.runId,
            listingId: listing.id,
            applyType: flow.type,
            step: "apply-flow-detected",
            timestamp: new Date().toISOString(),
          });

          if (flow.type !== "modal" && flow.type !== "modal-iframe") {
            const screenshotPath = await captureScreenshot(page, ctx, listing.id, "unsupported-flow");
            ctx.runLogger.logEvent({
              runId: ctx.runId,
              listingId: listing.id,
              applyType: flow.type,
              step: "skip",
              status: "skipped",
              reason: "unsupported apply flow",
              timestamp: new Date().toISOString(),
              screenshotPath,
            });
            return {
              listingId: listing.id,
              status: "skipped",
              message: `Unsupported apply flow (${flow.type})`,
              artifacts: {
                screenshotPath,
              },
            };
          }

          const meta = {
            runId: ctx.runId,
            listingId: listing.id,
            applyType: flow.type,
            logDir: ctx.logDir,
            runLogger: ctx.runLogger,
            setLastScreenshot: (path: string) => {
              ctx.lastScreenshotPath = path;
            },
          };

          await ctx.formEngine.mapAndFill(page, ctx.profile, ctx.resume, meta);
          await ctx.formEngine.answerScreening(page, ctx.profile, meta);
          const mode = ctx.dryRun ? "Dry-run" : "Dry-run enforced";
          const submitDetection = await ctx.formEngine.detectSubmitState(page, meta);
          ctx.runLogger.logEvent({
            runId: ctx.runId,
            listingId: listing.id,
            applyType: flow.type,
            step: "result",
            status: "dry-run",
            reason: submitDetection.reason,
            timestamp: new Date().toISOString(),
            screenshotPath: submitDetection.screenshotPath ?? ctx.lastScreenshotPath,
          });
          return {
            listingId: listing.id,
            status: "dry-run",
            message: `${mode}: ${submitDetection.state} (${submitDetection.reason})`,
            artifacts: {
              screenshotPath: submitDetection.screenshotPath ?? ctx.lastScreenshotPath,
            },
          };
        } catch (error) {
          const screenshotPath = await captureScreenshot(page, ctx, listing.id, "apply-error");
          ctx.runLogger.logEvent({
            runId: ctx.runId,
            listingId: listing.id,
            applyType: ctx.lastApplyType ?? "unknown",
            step: "error",
            status: "failed",
            reason: error instanceof Error ? error.message : "Apply failed",
            timestamp: new Date().toISOString(),
            screenshotPath,
          });
          return {
            listingId: listing.id,
            status: "failed",
            message: error instanceof Error ? error.message : "Apply failed",
            artifacts: {
              screenshotPath,
            },
          };
        }
      } finally {
        if (page && typeof page.close === "function") {
          await page.close();
        }
      }
    },
  };
}

function buildSearchUrl(title: string, location: string): string {
  const params = new URLSearchParams();
  if (title) params.set("q", title);
  if (location) params.set("l", location);
  return `https://www.indeed.com/jobs?${params.toString()}`;
}

async function scrapeListings(page: AutomationPage): Promise<JobListing[]> {
  const results = await page.evaluate(() => {
    const items: Array<{ url: string; title: string; company: string; location: string; jobKey?: string }> = [];
    const cardSelectors = [
      "div.job_seen_beacon",
      "div.jobsearch-SerpJobCard",
      "div.tapItem",
      "div[data-jk]",
    ];

    const cards = cardSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const uniqueCards = Array.from(new Set(cards));

    const getText = (el: Element | null | undefined) => el?.textContent?.trim() || "";

    for (const card of uniqueCards) {
      const titleLink =
        card.querySelector("a.jcs-JobTitle") ||
        card.querySelector("h2.jobTitle a") ||
        card.querySelector("a[data-jk]");

      const title = getText(titleLink);
      const href = titleLink?.getAttribute("href") || "";
      const jobKey = titleLink?.getAttribute("data-jk") || card.getAttribute("data-jk") || undefined;

      if (!title || (!href && !jobKey)) {
        continue;
      }

      const company =
        getText(card.querySelector(".companyName")) ||
        getText(card.querySelector(".company")) ||
        getText(card.querySelector("[data-testid=\"company-name\"]"));

      const location =
        getText(card.querySelector(".companyLocation")) ||
        getText(card.querySelector(".location")) ||
        getText(card.querySelector("[data-testid=\"text-location\"]"));

      items.push({
        url: href,
        title,
        company,
        location,
        jobKey,
      });
    }

    return items;
  });

  return results.map((item) => ({
    id: item.jobKey ?? item.url,
    board: "indeed",
    url: normalizeIndeedUrl(item.url, item.jobKey),
    title: item.title,
    company: item.company,
    location: item.location,
  }));
}

function normalizeIndeedUrl(url: string, jobKey?: string): string {
  if (url.startsWith("http")) {
    return url;
  }
  if (url && (url.startsWith("/") || url.startsWith("?"))) {
    return `https://www.indeed.com${url}`;
  }
  if (jobKey) {
    return `https://www.indeed.com/viewjob?jk=${jobKey}`;
  }
  return `https://www.indeed.com/jobs?from=autoapply`;
}

async function markApplyTarget(
  page: AutomationPage
): Promise<{ selector: string; kind: "indeed" | "external" | "unknown"; href?: string; ats?: string } | null> {
  const found = await page.locateApplyTarget();
  if (!found) {
    return null;
  }

  const text = (found.text ?? "").toLowerCase();
  const href = found.href ?? "";
  const isIndeedUrl = href.includes("indeed.com");
  const kind: "external" | "indeed" =
    text.includes("company site") || text.includes("company") || (href && !isIndeedUrl) ? "external" : "indeed";
  let ats: string | undefined;
  if (kind === "external" && href) {
    const url = href.toLowerCase();
    if (url.includes("greenhouse.io")) ats = "greenhouse";
    else if (url.includes("lever.co")) ats = "lever";
    else if (url.includes("workday")) ats = "workday";
    else if (url.includes("smartrecruiters")) ats = "smartrecruiters";
    else if (url.includes("icims")) ats = "icims";
    else if (url.includes("jobvite")) ats = "jobvite";
    else if (url.includes("breezy.hr")) ats = "breezy";
    else ats = "unknown";
  }

  return { selector: found.selector, kind, href, ats };
}

async function detectApplyFlow(page: AutomationPage): Promise<{ type: string }> {
  const result = await page.evaluate(() => {
    const hasModal =
      Boolean(document.querySelector("[role=\"dialog\"]")) ||
      Boolean(document.querySelector(".icl-Modal")) ||
      Boolean(document.querySelector("[data-testid=\"apply-modal\"]"));
    const hasIframe = Boolean(document.querySelector("iframe[src*=\"indeed\"]"));
    const hasForm = Boolean(document.querySelector("form"));

    let type = "unknown";
    if (hasIframe && hasModal) {
      type = "modal-iframe";
    } else if (hasModal) {
      type = "modal";
    } else if (hasForm) {
      type = "inline-form";
    }
    return { type };
  });

  return result;
}

async function captureScreenshot(
  page: AutomationPage,
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
    applyType: ctx.lastApplyType ?? "unknown",
    step,
    timestamp: new Date().toISOString(),
    screenshotPath,
  });
  return screenshotPath;
}

async function waitForManualVerification(page: AutomationPage, label: string): Promise<void> {
  const maxChecks = 60;
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    const needsVerification = await safeEvaluateVerification(page, label, maxRetries);
    if (!needsVerification) {
      return;
    }
    if (attempt === 0) {
      process.stdout.write(
        `[manual] Cloudflare verification detected (${label}). Complete it in the opened browser window...\\n`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  process.stdout.write(`[manual] Verification wait timed out (${label}).\\n`);
}

async function safeEvaluateVerification(
  page: AutomationPage,
  label: string,
  maxRetries: number
): Promise<boolean> {
  for (let retry = 0; retry < maxRetries; retry += 1) {
    try {
      return await page.evaluate(() => {
        const text = document.body?.textContent?.toLowerCase() || "";
        return text.includes("additional verification") || text.includes("cloudflare");
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes("execution context was destroyed")) {
        process.stdout.write(`[manual] Verification navigation detected (${label}); waiting...\\n`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw error;
    }
  }
  return true;
}

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { loadConfig, saveConfig, defaultConfig } from "../config";
import { addResumeToVault } from "../assets";
import { createConnectorRegistry } from "../connectors";
import { createPlaywrightSession } from "../automation";
import { GreenhouseFormEngine, IndeedFormEngine } from "../forms";
import { createLogger, createRunLogger } from "../logging";
import { FileJobRepo, InMemoryJobRepo } from "../storage/repositories";
import { FileJobStore } from "../storage/jobStore";
import { SimpleOrchestrator } from "../core/orchestrator";
import { ResumeAsset } from "../types/context";
import { JobRecord } from "../types/jobs";
import { discoverJobs } from "../discovery";
import { filterJobs } from "../discovery/filterJobs";
import { runGreenhouseDryRun, runGreenhouseDryRunForJobs } from "../core/greenhouseApply";

export async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "";

  switch (command) {
    case "init":
      await handleInit();
      return;
    case "resume":
      await handleResume(args.slice(1));
      return;
    case "profile":
      await handleProfile(args.slice(1));
      return;
    case "prefs":
      await handlePrefs(args.slice(1));
      return;
    case "config":
      await handleConfig(args.slice(1));
      return;
    case "profile":
      await handleProfile(args.slice(1));
      return;
    case "history":
      await handleHistory(args.slice(1));
      return;
    case "run":
      await handleRun(args.slice(1));
      return;
    case "discover":
      await handleDiscover(args.slice(1));
      return;
    case "jobs":
      await handleJobs(args.slice(1));
      return;
    case "apply":
      await handleApply(args.slice(1));
      return;
    case "probe":
      await handleProbe(args.slice(1));
      return;
    case "status":
      await handleStatus();
      return;
    default:
      printHelp();
      return;
  }
}

async function handleInit(): Promise<void> {
  const config = defaultConfig();
  saveConfig(config);
  process.stdout.write("Initialized config at ~/.autoapply/config.json\n");
}

async function handleResume(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  if (subcommand !== "add") {
    process.stderr.write("Unknown resume command. Use: autoapply resume add <path>\n");
    return;
  }

  const filePath = args[1];
  if (!filePath) {
    process.stderr.write("Resume path required. Use: autoapply resume add <path>\n");
    return;
  }

  const labelArg = readFlag(args, "--label");
  const label = labelArg ?? path.basename(filePath, path.extname(filePath));
  const setDefault = hasFlag(args, "--default");
  const config = loadConfig();

  const { resume, config: updatedConfig } = await addResumeToVault(config, filePath, {
    label,
    setDefault,
  });

  saveConfig(updatedConfig);
  process.stdout.write(`Added resume '${resume.label}' to vault.\n`);
}

async function handleProfile(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  if (subcommand === "info") {
    const config = loadConfig();
    const userDataDir = path.join(config.app.dataDir, "chrome-profile");
    const profileDir = "Default";
    process.stdout.write(`chromeProfile.userDataDir=${userDataDir}\n`);
    process.stdout.write(`chromeProfile.profileDir=${profileDir}\n`);
    return;
  }
  if (subcommand !== "set") {
    process.stderr.write("Unknown profile command. Use: autoapply profile set [flags] or autoapply profile info\n");
    return;
  }

  const config = loadConfig();
  const profile = { ...config.profile };
  const eeo = { ...(profile.eeo ?? {}) };

  const fullName = readFlag(args, "--full-name");
  if (fullName) {
    profile.fullName = fullName;
  }

  const email = readFlag(args, "--email");
  if (email) {
    profile.email = email;
  }

  const phone = readFlag(args, "--phone");
  if (phone) {
    profile.phone = phone;
  }

  const location = readFlag(args, "--location");
  if (location) {
    profile.location = location;
  }

  const workAuthorization = readFlag(args, "--work-auth");
  if (workAuthorization) {
    profile.workAuthorization = workAuthorization;
  }

  const sponsorship = readFlag(args, "--sponsorship");
  if (sponsorship) {
    profile.sponsorship = sponsorship;
  }

  const priorEmployment = readFlag(args, "--prior-employment");
  if (priorEmployment) {
    profile.priorEmployment = priorEmployment;
  }

  const referralSource = readFlag(args, "--referral-source");
  if (referralSource) {
    profile.referralSource = referralSource;
  }

  const state = readFlag(args, "--state");
  if (state) {
    profile.state = state;
  }

  const linkedin = readFlag(args, "--linkedin");
  if (linkedin) {
    profile.linkedin = linkedin;
  }

  const website = readFlag(args, "--website");
  if (website) {
    profile.website = website;
  }

  const github = readFlag(args, "--github");
  if (github) {
    profile.github = github;
  }

  const gender = readFlag(args, "--gender");
  if (gender) {
    eeo.gender = gender;
  }

  const lgbtq = readFlag(args, "--lgbtq");
  if (lgbtq) {
    eeo.lgbtq = lgbtq;
  }

  const raceEthnicity = readFlag(args, "--race");
  if (raceEthnicity) {
    eeo.raceEthnicity = raceEthnicity;
  }

  const veteranStatus = readFlag(args, "--veteran");
  if (veteranStatus) {
    eeo.veteranStatus = veteranStatus;
  }

  const disabilityStatus = readFlag(args, "--disability");
  if (disabilityStatus) {
    eeo.disabilityStatus = disabilityStatus;
  }

  const answers = { ...(profile.answers ?? {}) } as Record<string, string>;
  const answerEntries = readMultiFlag(args, "--answer");
  for (const entry of answerEntries) {
    const [key, ...rest] = entry.split("=");
    if (!key || rest.length === 0) {
      continue;
    }
    answers[key.trim()] = rest.join("=").trim();
  }
  profile.answers = Object.keys(answers).length > 0 ? answers : undefined;

  profile.eeo = Object.keys(eeo).length > 0 ? eeo : undefined;
  saveConfig({ ...config, profile });
  process.stdout.write("Profile updated.\n");
}

async function handlePrefs(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  if (subcommand !== "set") {
    process.stderr.write("Unknown prefs command. Use: autoapply prefs set [flags]\n");
    return;
  }

  const config = loadConfig();
  const prefs = { ...config.preferences };

  const titles = readMultiFlag(args, "--title");
  const locations = readMultiFlag(args, "--location");
  const keywords = readMultiFlag(args, "--keyword");
  const excludeKeywords = readMultiFlag(args, "--exclude-keyword");
  const experience = readMultiFlag(args, "--experience");

  if (titles.length > 0) {
    prefs.titles = titles;
  }

  if (locations.length > 0) {
    prefs.locations = locations;
  }

  if (keywords.length > 0) {
    prefs.keywords = keywords;
  }

  if (excludeKeywords.length > 0) {
    prefs.excludeKeywords = excludeKeywords;
  }

  if (experience.length > 0) {
    prefs.experience = experience;
  }

  if (hasFlag(args, "--remote")) {
    prefs.remote = true;
  }

  if (hasFlag(args, "--no-remote")) {
    prefs.remote = false;
  }

  if (hasFlag(args, "--hybrid")) {
    prefs.hybrid = true;
  }

  if (hasFlag(args, "--no-hybrid")) {
    prefs.hybrid = false;
  }

  saveConfig({ ...config, preferences: prefs });
  process.stdout.write("Preferences updated.\n");
}

async function handleRun(args: string[]): Promise<void> {
  const config = loadConfig();
  const board = readFlag(args, "--board") ?? config.app.defaultBoard;
  const dryRun = hasFlag(args, "--dry-run");
  const headless = false;
  const maxApplications = Number(readFlag(args, "--max-applications") ?? config.app.maxApplicationsPerRun);

  const resume = selectResume(config.resumes);
  if (!resume) {
    process.stderr.write("No resume configured. Use autoapply resume add <path> first.\n");
    return;
  }

  const userDataDir = path.join(config.app.dataDir, "chrome-profile");
  const profileDir = "Default";
  assertChromeProfileAvailable(userDataDir, profileDir, true);
  process.stdout.write(`[launch] userDataDir=${userDataDir} profileDir=${profileDir} persistent=true\n`);
  const automation = await createPlaywrightSession({
    headless,
    slowMoMs: config.app.slowMoMs,
    userDataDir,
    profileDir,
  });
  const connectors = createConnectorRegistry();
  const jobRepo = new InMemoryJobRepo();
  const logger = createLogger("form-engine");
  const formEngine = new IndeedFormEngine(logger);
  const runId = generateRunId();
  const logDir = path.join(config.app.dataDir, "runs", runId);
  fs.mkdirSync(logDir, { recursive: true });
  const runLogger = createRunLogger(logDir, runId);
  writeRunManifest(logDir, {
    runId,
    startedAt: new Date().toISOString(),
    board,
    dryRun,
    maxApplications,
  });

  const orchestrator = new SimpleOrchestrator(connectors, jobRepo, {
    profile: config.profile,
    resume,
    preferences: config.preferences,
    dryRun,
    maxApplications,
    automation,
    formEngine,
    runId,
    logDir,
    runLogger,
    dataDir: config.app.dataDir,
  });

  try {
    await orchestrator.run({
      board,
      dryRun,
      maxApplications,
      headless,
    });
  } finally {
    await automation.close();
  }

  const status = orchestrator.status();
  process.stdout.write(`Run complete. State: ${status.state}. Applied: ${status.appliedCount}.\n`);
}

async function handleStatus(): Promise<void> {
  process.stdout.write("No active run.\n");
}

async function handleDiscover(args: string[]): Promise<void> {
  const config = loadConfig();
  const registryPath = readFlag(args, "--registry") ?? path.join(process.cwd(), "companies.json");
  const result = await discoverJobs(registryPath);
  const store = new FileJobStore(config.app.dataDir, "jobs.json");
  await store.upsertMany(result.jobs);

  const filtered = hasFlag(args, "--filtered");
  if (filtered) {
    const filterResult = filterJobs(result.jobs, config.preferences);
    const filteredStore = new FileJobStore(config.app.dataDir, "filtered_jobs.json");
    await filteredStore.writeAll(filterResult.matched);
    printDiscoverySummary(result, filterResult);
    return;
  }

  printDiscoverySummary(result);
}

async function handleJobs(args: string[]): Promise<void> {
  const config = loadConfig();
  const limitValue = Number(readFlag(args, "--limit") ?? 20);
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 20;
  const store = new FileJobStore(config.app.dataDir, "filtered_jobs.json");
  const jobs = await store.loadAll();
  if (jobs.length === 0) {
    process.stdout.write("No filtered jobs found. Run: autoapply discover --filtered\n");
    return;
  }

  const slice = jobs.slice(0, limit);
  for (const job of slice) {
    process.stdout.write(`${job.company} | ${job.title} | ${job.location} | ${job.ats}\n`);
    process.stdout.write(`  ${job.applyUrl}\n`);
  }
}

async function handleApply(args: string[]): Promise<void> {
  const config = loadConfig();
  const ats = readFlag(args, "--ats") ?? "greenhouse";
  if (ats !== "greenhouse") {
    process.stderr.write("Only greenhouse is supported for apply in this step.\n");
    return;
  }
  const limitValue = Number(readFlag(args, "--limit") ?? 10);
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 10;
  const keepOpen = hasFlag(args, "--keep-open");
  const pauseOnVerification = hasFlag(args, "--pause-on-verification");
  const overrideUrl = readFlag(args, "--url");
  const submit = hasFlag(args, "--submit");
  const confirmSubmit = hasFlag(args, "--confirm");
  const discover = hasFlag(args, "--discover");
  const registryPath = readFlag(args, "--registry") ?? path.join(process.cwd(), "companies.json");

  if (submit && !confirmSubmit) {
    process.stderr.write("Refusing to submit without --confirm.\n");
    return;
  }

  const resume = selectResume(config.resumes);
  if (!resume) {
    process.stderr.write("No resume configured. Use autoapply resume add <path> first.\n");
    return;
  }

  const headless = false;
  const userDataDir = path.join(config.app.dataDir, "chrome-profile");
  const profileDir = "Default";
  assertChromeProfileAvailable(userDataDir, profileDir, true);
  process.stdout.write(`[launch] userDataDir=${userDataDir} profileDir=${profileDir} persistent=true\n`);
  const automation = await createPlaywrightSession({
    headless,
    slowMoMs: config.app.slowMoMs,
    userDataDir,
    profileDir,
  });

  const runId = generateRunId();
  const logDir = path.join(config.app.dataDir, "runs", runId);
  fs.mkdirSync(logDir, { recursive: true });
  const runLogger = createRunLogger(logDir, runId);
  writeRunManifest(logDir, {
    runId,
    startedAt: new Date().toISOString(),
    board: "greenhouse",
    dryRun: !submit,
    maxApplications: limit,
  });

  const logger = createLogger("greenhouse-form");
  const formEngine = new GreenhouseFormEngine(logger);
  const jobRepo = new FileJobRepo(config.app.dataDir);

  try {
    const ctx = {
      profile: config.profile,
      resume,
      preferences: config.preferences,
      dryRun: !submit,
      maxApplications: limit,
      automation,
      formEngine,
      runId,
      logDir,
      runLogger,
      dataDir: config.app.dataDir,
      keepOpen,
      pauseOnVerification,
    };

    let jobs: JobRecord[] | null = null;

    if (overrideUrl) {
      jobs = [
        {
          id: extractGreenhouseJobId(overrideUrl) ?? "manual",
          company: extractGreenhouseSlug(overrideUrl) ?? "manual",
          title: "Manual Greenhouse Job",
          location: "",
          ats: "greenhouse",
          applyUrl: overrideUrl,
          companySlug: extractGreenhouseSlug(overrideUrl) ?? undefined,
        },
      ];
    } else if (discover) {
      const discovery = await discoverJobs(registryPath);
      const store = new FileJobStore(config.app.dataDir, "jobs.json");
      await store.upsertMany(discovery.jobs);
      const filterResult = filterJobs(discovery.jobs, config.preferences);
      const filteredStore = new FileJobStore(config.app.dataDir, "filtered_jobs.json");
      await filteredStore.writeAll(filterResult.matched);
      jobs = filterResult.matched.filter((job) => job.ats === "greenhouse").slice(0, limit);
    }

    const summary = jobs
      ? await runGreenhouseDryRunForJobs(ctx, jobs, jobRepo)
      : await runGreenhouseDryRun(ctx, { limit, jobRepo });

    const counts = summary.results.reduce(
      (acc, result) => {
        acc[result.status] = (acc[result.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    process.stdout.write(`Greenhouse run attempted: ${summary.attempted} (dryRun=${!submit})\n`);
    for (const [status, count] of Object.entries(counts)) {
      process.stdout.write(`  ${status}: ${count}\n`);
    }
  } finally {
    if (!keepOpen) {
      await automation.close();
    } else {
      process.stdout.write("Keep-open enabled: leaving browser open.\n");
    }
  }
}

async function handleProbe(args: string[]): Promise<void> {
  const config = loadConfig();
  const headless = false;
  const overrideUrl = readFlag(args, "--url");
  const waitSeconds = Number(readFlag(args, "--verify-wait") ?? 300);
  const searchUrl = overrideUrl ?? buildIndeedSearchUrl(config);
  const maxListings = 3;
  const userDataDir = path.join(config.app.dataDir, "chrome-profile");
  const profileDir = "Default";
  assertChromeProfileAvailable(userDataDir, profileDir, true);
  process.stdout.write(`[launch] userDataDir=${userDataDir} profileDir=${profileDir} persistent=true\n`);
  const automation = await createPlaywrightSession({
    headless,
    slowMoMs: config.app.slowMoMs,
    userDataDir,
    profileDir,
  });

  try {
    const page = await automation.newPage();
    await waitForUser("If Chrome shows any prompts (restore pages, etc.), dismiss them now, then press Enter to continue...");
    process.stdout.write(`Probe search URL: ${searchUrl}\n`);
    await page.goto(searchUrl);
    await waitForManualVerification(page, "probe-search", waitSeconds);
    await page.waitFor("body", 15000);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2000)));

    for (let index = 0; index < maxListings; index += 1) {
      const marked = await page.evaluate((limit) => {
        const selectors = ["a.jcs-JobTitle", "h2.jobTitle a", "a[data-jk]"];
        const targets: HTMLElement[] = [];
        for (const selector of selectors) {
          const items = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
          for (const item of items) {
            if (!targets.includes(item)) {
              targets.push(item);
            }
            if (targets.length >= limit) {
              break;
            }
          }
          if (targets.length >= limit) {
            break;
          }
        }
        targets.forEach((el, idx) => el.setAttribute("data-autoapply-probe", String(idx)));
        return targets.length;
      }, maxListings);

      if (marked === 0 || index >= marked) {
        if (index === 0) {
          process.stdout.write("Job card link not found on search page.\n");
        }
        break;
      }

      await page.click(`[data-autoapply-probe="${index}"]`);
      await page.waitFor("body", 15000);
      await waitForManualVerification(page, "probe-detail", waitSeconds);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2000)));

      const beforeInfo = await page.evaluate(() => {
        const iframeCount = document.querySelectorAll("iframe").length;
        return { iframeCount };
      });

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500)));

      const applyTarget = await page.locateApplyTarget();
      const afterInfo = await page.evaluate(() => {
        const iframeCount = document.querySelectorAll("iframe").length;
        const applyTexts = Array.from(document.querySelectorAll("button, a"))
          .map((el) => el.textContent?.trim() || "")
          .filter((text) => text.length > 0 && text.toLowerCase().includes("apply"))
          .slice(0, 10);
        return { iframeCount, applyTexts };
      });

      const targetLocation = applyTarget
        ? "main-document"
        : afterInfo.iframeCount > 0
          ? "possible-iframe"
          : "none";

      process.stdout.write(`\nListing ${index + 1}:\n`);
      if (applyTarget) {
        process.stdout.write(
          `Apply target detected after scroll: selector=${applyTarget.selector} text="${applyTarget.text ?? ""}" href="${applyTarget.href ?? ""}"\n`
        );
      } else {
        process.stdout.write("Apply target detected after scroll: none\n");
      }
      process.stdout.write(
        `Iframes before=${beforeInfo.iframeCount} after=${afterInfo.iframeCount} targetLocation=${targetLocation}\n`
      );
      process.stdout.write(`Apply text candidates: ${JSON.stringify(afterInfo.applyTexts)}\n`);
      await page.goBack();
      await waitForManualVerification(page, "probe-back", waitSeconds);
      await page.waitFor("body", 15000);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1500)));
    }

    await page.close();
  } finally {
    await automation.close();
  }
}

async function waitForManualVerification(
  page: { evaluate: (fn: () => boolean | Promise<boolean>) => Promise<boolean> },
  label: string,
  waitSeconds: number
): Promise<void> {
  const maxChecks = Math.max(1, Math.floor(waitSeconds / 2));
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
  page: { evaluate: (fn: () => boolean | Promise<boolean>) => Promise<boolean> },
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

async function handleConfig(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  if (subcommand !== "show") {
    process.stderr.write("Unknown config command. Use: autoapply config show\n");
    return;
  }

  const config = loadConfig();
  const redacted = redactConfig(config);
  process.stdout.write(`${JSON.stringify(redacted, null, 2)}\n`);
}

async function handleHistory(args: string[]): Promise<void> {
  const config = loadConfig();
  const runId = readFlag(args, "--run");
  const verbose = hasFlag(args, "--verbose");
  const limitValue = Number(readFlag(args, "--limit") ?? 10);
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 10;
  const runsDir = path.join(config.app.dataDir, "runs");

  if (!fs.existsSync(runsDir)) {
    process.stdout.write("No runs found.\n");
    return;
  }

  if (runId) {
    const runDir = path.join(runsDir, runId);
    if (!fs.existsSync(runDir)) {
      process.stdout.write(`Run not found: ${runId}\n`);
      return;
    }

    const details = readRunDetails(runDir, runId);
    printRunDetails(details, { verbose });
    return;
  }

  const runDirs = fs
    .readdirSync(runsDir)
    .filter((entry: string) => fs.statSync(path.join(runsDir, entry)).isDirectory())
    .map((runId: string) => ({ runId, dir: path.join(runsDir, runId) }));

  const runs = runDirs
    .map((entry: { runId: string; dir: string }) => readRunSummary(entry.dir, entry.runId))
    .sort((a: { timestamp: string }, b: { timestamp: string }) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);

  if (runs.length === 0) {
    process.stdout.write("No runs found.\n");
    return;
  }

  for (const run of runs) {
    process.stdout.write(
      `${run.runId} | ${run.timestamp} | board=${run.board} | dryRun=${run.dryRun} | attempted=${run.attempted} | skipped=${run.skipped} | failed=${run.failed}\n`
    );
    process.stdout.write(`  log: ${run.logPath}\n`);
    process.stdout.write(`  artifacts: ${run.artifactsDir}\n`);
  }
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function readMultiFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && typeof args[i + 1] === "string") {
      values.push(...splitList(args[i + 1]));
    }
  }
  return values;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function redactConfig(config: ReturnType<typeof loadConfig>): ReturnType<typeof loadConfig> {
  const profile = {
    ...config.profile,
    email: redactValue(config.profile.email),
    phone: redactValue(config.profile.phone),
  };

  const resumes = config.resumes.map((resume) => ({
    ...resume,
    path: redactPath(resume.path),
    sha256: redactValue(resume.sha256),
  }));

  return {
    ...config,
    profile,
    resumes,
  };
}

function redactValue(value: string): string {
  if (value.length === 0) {
    return value;
  }

  if (value.length <= 4) {
    return "***";
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function redactPath(value: string): string {
  const parts = value.split(/[/\\\\]/);
  const filename = parts[parts.length - 1];
  return filename ? `***${filename}` : "***";
}

function selectResume(resumes: ResumeAsset[]): ResumeAsset | undefined {
  const defaultResume = resumes.find((resume) => resume.isDefault);
  return defaultResume ?? resumes[0];
}

function generateRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const random = crypto.randomBytes(3).toString("hex");
  return `${stamp}_${random}`;
}

function writeRunManifest(
  logDir: string,
  payload: { runId: string; startedAt: string; board: string; dryRun: boolean; maxApplications: number }
): void {
  const manifestPath = path.join(logDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(payload, null, 2), "utf8");
}

function readRunSummary(runDir: string, runId: string): {
  runId: string;
  timestamp: string;
  board: string;
  dryRun: boolean;
  attempted: number;
  skipped: number;
  failed: number;
  logPath: string;
  artifactsDir: string;
} {
  const manifestPath = path.join(runDir, "manifest.json");
  const logPath = path.join(runDir, `run-${runId}.jsonl`);
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { startedAt: runId, board: "unknown", dryRun: false };

  const counts = { attempted: 0, skipped: 0, failed: 0 };
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, "utf8").split("\n").filter((line: string) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { step?: string };
        if (event.step === "attempt") counts.attempted += 1;
        if (event.step === "skip") counts.skipped += 1;
        if (event.step === "error") counts.failed += 1;
      } catch {
        continue;
      }
    }
  }

  return {
    runId,
    timestamp: manifest.startedAt ?? runId,
    board: manifest.board ?? "unknown",
    dryRun: Boolean(manifest.dryRun),
    attempted: counts.attempted,
    skipped: counts.skipped,
    failed: counts.failed,
    logPath,
    artifactsDir: runDir,
  };
}

function readRunDetails(
  runDir: string,
  runId: string
): {
  runId: string;
  timestamp: string;
  board: string;
  dryRun: boolean;
  maxApplications?: number;
  logPath: string;
  artifactsDir: string;
  listings: Array<{
    listingId: string;
    title?: string;
    company?: string;
    applyType?: string;
    status?: string;
    reason?: string;
    submitState?: string;
    submitReason?: string;
    submitPolicy?: string;
    submitPolicyReason?: string;
    externalUrl?: string;
    externalAts?: string;
    screenshotPath?: string;
  }>;
} {
  const manifestPath = path.join(runDir, "manifest.json");
  const logPath = path.join(runDir, `run-${runId}.jsonl`);
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : { startedAt: runId, board: "unknown", dryRun: false };

  const listings = new Map<
    string,
    {
      listingId: string;
      title?: string;
      company?: string;
      applyType?: string;
      status?: string;
      reason?: string;
      submitState?: string;
      submitReason?: string;
      submitPolicy?: string;
      submitPolicyReason?: string;
      externalUrl?: string;
      externalAts?: string;
      screenshotPath?: string;
    }
  >();

  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, "utf8").split("\n").filter((line: string) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as {
          listingId?: string;
          title?: string;
          company?: string;
          applyType?: string;
          status?: string;
          reason?: string;
          screenshotPath?: string;
          step?: string;
          externalUrl?: string;
          externalAts?: string;
        };
        if (!event.listingId) {
          continue;
        }

        const record = listings.get(event.listingId) ?? { listingId: event.listingId };
        if (event.title) record.title = event.title;
        if (event.company) record.company = event.company;
        if (event.applyType) record.applyType = event.applyType;
        if (event.status) record.status = event.status;
        if (event.reason) record.reason = event.reason;
        if (event.screenshotPath) record.screenshotPath = event.screenshotPath;
        if (event.step === "submit-detect") {
          record.submitState = event.status ?? "unknown";
          record.submitReason = event.reason;
        }
        if (event.step === "submit-policy") {
          record.submitPolicy = event.status ?? "unknown";
          record.submitPolicyReason = event.reason;
        }
        if (event.externalUrl) {
          record.externalUrl = event.externalUrl;
        }
        if (event.externalAts) {
          record.externalAts = event.externalAts;
        }
        listings.set(event.listingId, record);
      } catch {
        continue;
      }
    }
  }

  return {
    runId,
    timestamp: manifest.startedAt ?? runId,
    board: manifest.board ?? "unknown",
    dryRun: Boolean(manifest.dryRun),
    maxApplications: manifest.maxApplications,
    logPath,
    artifactsDir: runDir,
    listings: Array.from(listings.values()),
  };
}

function printRunDetails(details: ReturnType<typeof readRunDetails>, options: { verbose: boolean }): void {
  process.stdout.write(`${details.runId} | ${details.timestamp} | board=${details.board} | dryRun=${details.dryRun}\n`);
  if (typeof details.maxApplications === "number") {
    process.stdout.write(`maxApplications=${details.maxApplications}\n`);
  }
  process.stdout.write(`log: ${details.logPath}\n`);
  process.stdout.write(`artifacts: ${details.artifactsDir}\n`);

  const grouped = groupByStatus(details.listings);
  const order = ["dry-run", "skipped", "failed", "unknown"];

  for (const status of order) {
    const items = grouped.get(status);
    if (!items || items.length === 0) {
      continue;
    }
    process.stdout.write(`\n${status.toUpperCase()} (${items.length})\n`);
    for (const item of items) {
      const title = item.title ? ` | ${item.title}` : "";
      const company = item.company ? ` | ${item.company}` : "";
      const applyType = item.applyType ? ` | applyType=${item.applyType}` : "";
      const reason = item.reason ? ` | reason=${item.reason}` : "";
      const submitState = item.submitState ? ` | submit=${shortenSubmitState(item.submitState)}` : "";
      const submitPolicy = item.submitPolicy ? ` | policy=${item.submitPolicy}` : "";
      const submitReason = options.verbose && item.submitReason ? ` | submitReason=${item.submitReason}` : "";
      const policyReason =
        options.verbose && item.submitPolicyReason ? ` | policyReason=${item.submitPolicyReason}` : "";
      const external =
        options.verbose && (item.externalUrl || item.externalAts)
          ? ` | external=${item.externalAts ?? "unknown"} | externalUrl=${item.externalUrl ?? ""}`.trim()
          : "";
      process.stdout.write(
        `${item.listingId}${title}${company}${applyType}${submitState}${submitPolicy}${submitReason}${policyReason}${external}${reason}\n`
      );
      if (item.screenshotPath) {
        process.stdout.write(`  screenshot: ${item.screenshotPath}\n`);
      }
    }
  }

  const submitTotals = tally(details.listings, (item) => item.submitState ?? "unknown");
  const policyTotals = tally(details.listings, (item) => item.submitPolicy ?? "unknown");
  process.stdout.write("\nSubmit totals:\n");
  process.stdout.write(
    `  ready=${submitTotals.get("ready-to-submit") ?? 0} | incomplete=${submitTotals.get("incomplete") ?? 0} | blocked=${
      submitTotals.get("blocked") ?? 0
    }\n`
  );
  process.stdout.write("Policy totals:\n");
  process.stdout.write(`  pass=${policyTotals.get("pass") ?? 0} | fail=${policyTotals.get("fail") ?? 0}\n`);
}

function shortenSubmitState(state: string): string {
  if (state === "ready-to-submit") {
    return "ready";
  }
  if (state === "incomplete") {
    return "incomplete";
  }
  if (state === "blocked") {
    return "blocked";
  }
  return state;
}

function groupByStatus<T extends { status?: string }>(listings: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const listing of listings) {
    const status = listing.status ?? "unknown";
    const bucket = grouped.get(status) ?? [];
    bucket.push(listing);
    grouped.set(status, bucket);
  }
  return grouped;
}

function tally<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function extractGreenhouseSlug(url: string): string | null {
  const match = url.match(/greenhouse\.io\/([^/]+)\/jobs\//i);
  return match ? match[1] : null;
}

function extractGreenhouseJobId(url: string): string | null {
  const match = url.match(/\/jobs\/(\d+)/i);
  return match ? match[1] : null;
}

function printHelp(): void {
  process.stdout.write("autoapply <command>\n\n");
  process.stdout.write("Commands:\n");
  process.stdout.write("  init\n");
  process.stdout.write("  resume add <path> [--label <name>] [--default]\n");
  process.stdout.write(
    "  profile set [--full-name <name>] [--email <email>] [--phone <phone>] [--location <loc>] [--work-auth <value>] [--sponsorship <value>] [--prior-employment <value>] [--referral-source <value>] [--state <value>] [--linkedin <url>] [--website <url>] [--github <url>] [--gender <value>] [--lgbtq <value>] [--race <value>] [--veteran <value>] [--disability <value>]\n"
  );
  process.stdout.write("  profile info\n");
  process.stdout.write(
    "  prefs set [--title <value>] [--location <value>] [--keyword <value>] [--exclude-keyword <value>] [--experience <value>] [--remote|--no-remote] [--hybrid|--no-hybrid]\n"
  );
  process.stdout.write("  config show\n");
  process.stdout.write("  history [--limit 10] [--run <runId>] [--verbose]\n");
  process.stdout.write("  discover [--registry <path>] [--filtered]\n");
  process.stdout.write("  jobs list [--limit N]\n");
  process.stdout.write("  apply [--ats greenhouse] [--limit N] [--url <jobUrl>] [--keep-open] [--pause-on-verification]\n");
  process.stdout.write("  run [--board indeed] [--dry-run] [--max-applications 25] [--headless]\n");
  process.stdout.write("  probe [--url <searchUrl>] [--verify-wait <seconds>]\n");
  process.stdout.write("  status\n");
}

function buildIndeedSearchUrl(config: ReturnType<typeof loadConfig>): string {
  const title = config.preferences.titles?.[0] ?? "";
  const location = config.preferences.locations?.[0] ?? "";
  const params = new URLSearchParams();
  if (title) params.set("q", title);
  if (location) params.set("l", location);
  return `https://www.indeed.com/jobs?${params.toString()}`;
}

function assertChromeProfileAvailable(userDataDir: string, profileDir: string, createIfMissing = false): void {
  if (createIfMissing) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  const profilePath = path.join(userDataDir, profileDir);
  if (!fs.existsSync(profilePath)) {
    if (createIfMissing) {
      fs.mkdirSync(profilePath, { recursive: true });
    } else {
      throw new Error(`Chrome profile not found: ${profilePath}`);
    }
  }
  const lockPath = path.join(userDataDir, "SingletonLock");
  if (fs.existsSync(lockPath)) {
    throw new Error(
      `Chrome appears to be running (profile lock detected at ${lockPath}). Please close Chrome and retry.`
    );
  }
}

async function waitForUser(message: string): Promise<void> {
  process.stdout.write(`${message}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question("> ", () => {
      rl.close();
      resolve();
    });
  });
}

function printDiscoverySummary(
  result: {
    jobs: unknown[];
    countsByAts: Record<string, number>;
    countsByCompany: Record<string, number>;
    failures?: Array<{ name: string; ats: string; slug: string; error: string }>;
  },
  filterResult?: {
    counts: {
      total: number;
      matched: number;
      skippedTitle: number;
      skippedLocation: number;
      skippedExclude: number;
      skippedExperience: number;
      skippedRole: number;
      skippedSeniority: number;
    };
  }
): void {
  process.stdout.write(`Discovered ${result.jobs.length} jobs.\n`);
  process.stdout.write("Counts by ATS:\n");
  for (const [ats, count] of Object.entries(result.countsByAts)) {
    process.stdout.write(`  ${ats}: ${count}\n`);
  }
  process.stdout.write("Counts by company:\n");
  for (const [company, count] of Object.entries(result.countsByCompany)) {
    process.stdout.write(`  ${company}: ${count}\n`);
  }
  if (result.failures && result.failures.length > 0) {
    process.stdout.write("Failures:\n");
    for (const failure of result.failures) {
      process.stdout.write(`  ${failure.name} (${failure.ats}/${failure.slug}): ${failure.error}\n`);
    }
  }
  if (filterResult) {
    process.stdout.write("Filter results:\n");
    process.stdout.write(`  matched: ${filterResult.counts.matched}\n`);
    process.stdout.write(`  skippedTitle: ${filterResult.counts.skippedTitle}\n`);
    process.stdout.write(`  skippedLocation: ${filterResult.counts.skippedLocation}\n`);
    process.stdout.write(`  skippedExclude: ${filterResult.counts.skippedExclude}\n`);
    process.stdout.write(`  skippedExperience: ${filterResult.counts.skippedExperience}\n`);
    process.stdout.write(`  skippedRole: ${filterResult.counts.skippedRole}\n`);
    process.stdout.write(`  skippedSeniority: ${filterResult.counts.skippedSeniority}\n`);
  }
}

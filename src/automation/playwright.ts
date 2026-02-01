import { chromium, Browser, BrowserContext, Page } from "playwright";
import { AutomationPage, AutomationSession } from "./session";

export interface PlaywrightOptions {
  headless: boolean;
  slowMoMs: number;
  userDataDir?: string;
  profileDir?: string;
}

export async function createPlaywrightSession(options: PlaywrightOptions): Promise<AutomationSession> {
  const browserOverride = (process.env.AUTOAPPLY_BROWSER || "").toLowerCase();
  const useChromium = browserOverride === "chromium";
  const chromiumPath = process.env.AUTOAPPLY_CHROMIUM_PATH;
  const executablePath = useChromium
    ? chromiumPath && chromiumPath.length > 0
      ? chromiumPath
      : undefined
    : process.env.AUTOAPPLY_CHROME_PATH;
  const extraArgs = [
    "--disable-crashpad",
    "--disable-crash-reporter",
    "--no-crashpad",
  ];
  const launchOptions = {
    headless: options.userDataDir ? false : options.headless,
    slowMo: options.slowMoMs,
    executablePath: executablePath && executablePath.length > 0 ? executablePath : undefined,
    channel: options.userDataDir && !useChromium ? "chrome" : undefined,
    args: [
      ...(options.profileDir ? [`--profile-directory=${options.profileDir}`] : []),
      ...extraArgs,
    ],
  };

  if (options.userDataDir) {
    const context = await chromium.launchPersistentContext(options.userDataDir, launchOptions);
    return new PlaywrightPersistentSession(context);
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext();
  return new PlaywrightAutomationSession(browser, context);
}

class PlaywrightAutomationSession implements AutomationSession {
  private browser: Browser;
  private context: BrowserContext;

  constructor(browser: Browser, context: BrowserContext) {
    this.browser = browser;
    this.context = context;
  }

  async newPage(): Promise<AutomationPage> {
    const page = await this.context.newPage();
    return new PlaywrightAutomationPage(page);
  }

  async close(): Promise<void> {
    await this.context.close();
    await this.browser.close();
  }
}

class PlaywrightPersistentSession implements AutomationSession {
  private context: BrowserContext;

  constructor(context: BrowserContext) {
    this.context = context;
  }

  async newPage(): Promise<AutomationPage> {
    const page = await this.context.newPage();
    return new PlaywrightAutomationPage(page);
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

class PlaywrightAutomationPage implements AutomationPage {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  async clickWithOutcome(
    selector: string,
    timeoutMs = 8000
  ): Promise<{ page?: AutomationPage; path: string }> {
    const popupPromise = this.page.context().waitForEvent("page", { timeout: timeoutMs }).catch(() => null);
    const navPromise = this.page.waitForNavigation({ timeout: timeoutMs }).catch(() => null);
    const beforeUrl = this.page.url();
    await this.page.click(selector);
    const result = await Promise.race([popupPromise, navPromise, this.page.waitForTimeout(2000)]);
    if (result && typeof (result as Page).waitForLoadState === "function") {
      const popup = result as Page;
      await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
      await popup.bringToFront().catch(() => undefined);
      return { page: new PlaywrightAutomationPage(popup), path: "new-tab" };
    }
    const afterUrl = this.page.url();
    if (afterUrl !== beforeUrl) {
      return { path: "same-page-navigation" };
    }
    return { path: "same-page-no-nav" };
  }

  async uploadFile(selector: string, filePath: string): Promise<void> {
    await this.page.setInputFiles(selector, filePath);
  }

  async waitFor(selector: string, timeoutMs = 10000): Promise<void> {
    await this.page.waitForSelector(selector, { timeout: timeoutMs });
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: true });
  }

  async evaluate<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<T> {
    return this.page.evaluate(fn, ...args);
  }

  async close(): Promise<void> {
    await this.page.close();
  }

  async locateApplyTarget(): Promise<{ selector: string; href?: string; text?: string } | null> {
    const candidates = [
      this.page.getByRole("button", { name: /apply/i }),
      this.page.getByRole("link", { name: /apply/i }),
      this.page.locator("button, a").filter({ hasText: /apply/i }),
    ];

    for (const locator of candidates) {
      if ((await locator.count()) === 0) {
        continue;
      }

      const first = locator.first();
      const data = await first.evaluate((el) => {
        const element = el as HTMLElement;
        element.setAttribute("data-autoapply-target", "apply");
        const href = (element as HTMLAnchorElement).href || "";
        const text = element.textContent?.trim() || "";
        return { href, text };
      });

      return { selector: "[data-autoapply-target=\"apply\"]", href: data.href, text: data.text };
    }

    return null;
  }

  async goBack(): Promise<void> {
    await this.page.goBack({ waitUntil: "domcontentloaded" });
  }
}

export interface AutomationSession {
  newPage(): Promise<AutomationPage>;
  close(): Promise<void>;
}

export interface AutomationPage {
  goto(url: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  clickWithOutcome(selector: string, timeoutMs?: number): Promise<{ page?: AutomationPage; path: string }>;
  uploadFile(selector: string, filePath: string): Promise<void>;
  waitFor(selector: string, timeoutMs?: number): Promise<void>;
  screenshot(path: string): Promise<void>;
  evaluate<T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]): Promise<T>;
  close(): Promise<void>;
  locateApplyTarget(): Promise<{ selector: string; href?: string; text?: string } | null>;
  goBack(): Promise<void>;
}

export class NullAutomationSession implements AutomationSession {
  async newPage(): Promise<AutomationPage> {
    return new NullAutomationPage();
  }

  async close(): Promise<void> {
    return;
  }
}

class NullAutomationPage implements AutomationPage {
  async goto(_url: string): Promise<void> {
    return;
  }

  async fill(_selector: string, _value: string): Promise<void> {
    return;
  }

  async click(_selector: string): Promise<void> {
    return;
  }

  async clickWithOutcome(
    _selector: string,
    _timeoutMs = 8000
  ): Promise<{ page?: AutomationPage; path: string }> {
    return { path: "same-page-no-nav" };
  }

  async uploadFile(_selector: string, _filePath: string): Promise<void> {
    return;
  }

  async waitFor(_selector: string, _timeoutMs?: number): Promise<void> {
    return;
  }

  async screenshot(_path: string): Promise<void> {
    return;
  }

  async evaluate<T>(_fn: (...args: any[]) => T | Promise<T>, ..._args: any[]): Promise<T> {
    return undefined as T;
  }

  async close(): Promise<void> {
    return;
  }

  async locateApplyTarget(): Promise<{ selector: string; href?: string; text?: string } | null> {
    return null;
  }

  async goBack(): Promise<void> {
    return;
  }
}

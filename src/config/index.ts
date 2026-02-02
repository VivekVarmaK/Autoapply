import fs from "fs";
import os from "os";
import path from "path";
import { SearchCriteria } from "../types/boards";
import { ResumeAsset, UserProfile } from "../types/context";
import { validateConfig } from "./validate";
import { migrateConfig } from "./migrate";

export interface AppConfig {
  schemaVersion: number;
  app: {
    dataDir: string;
    dbPath: string;
    assetsDir: string;
    defaultBoard: string;
    headless: boolean;
    slowMoMs: number;
    maxApplicationsPerRun: number;
  };
  profile: UserProfile;
  resumes: ResumeAsset[];
  preferences: SearchCriteria;
}

export function defaultConfig(): AppConfig {
  const dataDir = path.join(os.homedir(), ".autoapply");
  return {
    schemaVersion: 1,
    app: {
      dataDir,
      dbPath: path.join(dataDir, "autoapply.db"),
      assetsDir: path.join(dataDir, "assets"),
      defaultBoard: "indeed",
      headless: false,
      slowMoMs: 200,
      maxApplicationsPerRun: 25,
    },
    profile: {
      fullName: "",
      email: "",
      phone: "",
      answers: {},
    },
    resumes: [],
    preferences: {
      titles: [],
      locations: [],
      keywords: [],
      excludeKeywords: [],
    },
  };
}

export function configPath(): string {
  return path.join(os.homedir(), ".autoapply", "config.json");
}

export function loadConfig(): AppConfig {
  const filePath = configPath();
  if (!fs.existsSync(filePath)) {
    return defaultConfig();
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const migrated = migrateConfig(parsed);
  const validated = validateConfig(migrated.config);
  if (migrated.changed) {
    saveConfig(validated);
  }
  return validated;
}

export function saveConfig(config: AppConfig): void {
  const filePath = configPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
}

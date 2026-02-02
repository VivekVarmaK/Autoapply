import os from "os";
import path from "path";
import { AppConfig, defaultConfig } from "./index";
import { CURRENT_SCHEMA_VERSION } from "./migrate";
import { ResumeAsset, UserProfile } from "../types/context";
import { SearchCriteria } from "../types/boards";

interface PartialConfig {
  app?: Partial<AppConfig["app"]>;
  profile?: Partial<UserProfile>;
  resumes?: ResumeAsset[];
  preferences?: Partial<SearchCriteria>;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function expandHome(value: string): string {
  if (!value.startsWith("~")) {
    return value;
  }

  return path.join(os.homedir(), value.slice(1));
}

export function validateConfig(raw: unknown): AppConfig {
  const base = defaultConfig();
  const config = (raw ?? {}) as PartialConfig;

  const schemaVersion =
    typeof (raw as { schemaVersion?: unknown })?.schemaVersion === "number"
      ? (raw as { schemaVersion: number }).schemaVersion
      : CURRENT_SCHEMA_VERSION;

  const app = {
    ...base.app,
    ...config.app,
    llm: {
      ...base.app.llm,
      ...(config.app?.llm ?? {}),
    },
  };

  if (typeof app.dataDir !== "string" || app.dataDir.length === 0) {
    app.dataDir = base.app.dataDir;
  }

  app.dataDir = expandHome(app.dataDir);

  if (typeof app.dbPath !== "string" || app.dbPath.length === 0) {
    app.dbPath = path.join(app.dataDir, "autoapply.db");
  }

  if (typeof app.assetsDir !== "string" || app.assetsDir.length === 0) {
    app.assetsDir = path.join(app.dataDir, "assets");
  }

  if (typeof app.defaultBoard !== "string") {
    app.defaultBoard = base.app.defaultBoard;
  }

  if (typeof app.headless !== "boolean") {
    app.headless = base.app.headless;
  }

  if (typeof app.slowMoMs !== "number" || Number.isNaN(app.slowMoMs)) {
    app.slowMoMs = base.app.slowMoMs;
  }

  if (typeof app.maxApplicationsPerRun !== "number" || Number.isNaN(app.maxApplicationsPerRun)) {
    app.maxApplicationsPerRun = base.app.maxApplicationsPerRun;
  }

  if (typeof app.llm?.provider !== "string") {
    app.llm.provider = base.app.llm.provider;
  }
  if (typeof app.llm?.model !== "string") {
    app.llm.model = base.app.llm.model;
  }
  if (typeof app.llm?.maxCostPerAnswerUsd !== "number" || Number.isNaN(app.llm.maxCostPerAnswerUsd)) {
    app.llm.maxCostPerAnswerUsd = base.app.llm.maxCostPerAnswerUsd;
  }
  if (typeof app.llm?.maxOutputTokens !== "number" || Number.isNaN(app.llm.maxOutputTokens)) {
    app.llm.maxOutputTokens = base.app.llm.maxOutputTokens;
  }
  if (typeof app.llm?.enabled !== "boolean") {
    app.llm.enabled = base.app.llm.enabled;
  }

  const profile: UserProfile = {
    ...base.profile,
    ...config.profile,
  };

  if (typeof profile.fullName !== "string") {
    profile.fullName = "";
  }

  if (typeof profile.email !== "string") {
    profile.email = "";
  }

  if (typeof profile.phone !== "string") {
    profile.phone = "";
  }

  if (profile.location && typeof profile.location !== "string") {
    profile.location = "";
  }

  if (profile.workAuthorization && typeof profile.workAuthorization !== "string") {
    profile.workAuthorization = "";
  }
  if (profile.sponsorship && typeof profile.sponsorship !== "string") {
    profile.sponsorship = "";
  }
  if (profile.priorEmployment && typeof profile.priorEmployment !== "string") {
    profile.priorEmployment = "";
  }
  if (profile.referralSource && typeof profile.referralSource !== "string") {
    profile.referralSource = "";
  }
  if (profile.state && typeof profile.state !== "string") {
    profile.state = "";
  }
  if (profile.linkedin && typeof profile.linkedin !== "string") {
    profile.linkedin = "";
  }
  if (profile.website && typeof profile.website !== "string") {
    profile.website = "";
  }
  if (profile.github && typeof profile.github !== "string") {
    profile.github = "";
  }
  if (profile.summary && typeof profile.summary !== "string") {
    profile.summary = "";
  }
  if (profile.skills && !Array.isArray(profile.skills)) {
    profile.skills = [];
  }

  if (profile.eeo && typeof profile.eeo !== "object") {
    profile.eeo = undefined;
  }
  if (profile.eeo?.lgbtq && typeof profile.eeo.lgbtq !== "string") {
    profile.eeo.lgbtq = "";
  }

  if (profile.answers && typeof profile.answers !== "object") {
    profile.answers = {};
  }
  if (profile.answers) {
    for (const [key, value] of Object.entries(profile.answers)) {
      if (typeof value !== "string") {
        delete profile.answers[key];
      }
    }
  }

  const resumes = Array.isArray(config.resumes) ? config.resumes.filter(isResumeAsset) : [];

  const preferences: SearchCriteria = {
    titles: isStringArray(config.preferences?.titles) ? config.preferences!.titles : base.preferences.titles,
    locations: isStringArray(config.preferences?.locations) ? config.preferences!.locations : base.preferences.locations,
    keywords: isStringArray(config.preferences?.keywords) ? config.preferences!.keywords : base.preferences.keywords,
    excludeKeywords: isStringArray(config.preferences?.excludeKeywords)
      ? config.preferences!.excludeKeywords
      : base.preferences.excludeKeywords,
    experience: isStringArray(config.preferences?.experience) ? config.preferences!.experience : base.preferences.experience,
    remote: typeof config.preferences?.remote === "boolean" ? config.preferences.remote : base.preferences.remote,
    hybrid: typeof config.preferences?.hybrid === "boolean" ? config.preferences.hybrid : base.preferences.hybrid,
  };

  return {
    schemaVersion,
    app,
    profile,
    resumes,
    preferences,
  };
}

function isResumeAsset(value: unknown): value is ResumeAsset {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as ResumeAsset;
  return (
    typeof record.label === "string" &&
    typeof record.path === "string" &&
    typeof record.sha256 === "string" &&
    typeof record.isDefault === "boolean"
  );
}

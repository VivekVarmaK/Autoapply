import { defaultConfig } from "./index";

export const CURRENT_SCHEMA_VERSION = 1;

export function migrateConfig(raw: unknown): { config: unknown; changed: boolean } {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") {
    return { config: { ...base, schemaVersion: CURRENT_SCHEMA_VERSION }, changed: true };
  }

  const config = raw as Record<string, unknown>;
  const schemaVersion = typeof config.schemaVersion === "number" ? config.schemaVersion : 0;
  let changed = false;

  if (schemaVersion < 1) {
    config.schemaVersion = 1;
    changed = true;
  }

  if (config.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    config.schemaVersion = CURRENT_SCHEMA_VERSION;
    changed = true;
  }

  return { config, changed };
}

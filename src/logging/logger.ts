export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export function createLogger(scope: string): Logger {
  const prefix = `[${scope}]`;
  return {
    info: (message) => log("INFO", prefix, message),
    warn: (message) => log("WARN", prefix, message),
    error: (message) => log("ERROR", prefix, message),
  };
}

function log(level: string, prefix: string, message: string): void {
  const timestamp = new Date().toISOString();
  process.stdout.write(`${timestamp} ${level} ${prefix} ${message}\n`);
}

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|hash/i;

/** Recursively redacts values whose keys look sensitive so credentials never reach logs. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level: Level, message: string, context?: Record<string, unknown>) {
  const line = {
    time: new Date().toISOString(),
    level,
    service: "infrapilot",
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };
  const serialized = JSON.stringify(line);
  if (level === "error" || level === "warn") {
    process.stderr.write(serialized + "\n");
  } else {
    process.stdout.write(serialized + "\n");
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === "debug") write("debug", message, context);
  },
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
};

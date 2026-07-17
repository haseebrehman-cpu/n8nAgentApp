/**
 * Minimal structured logger — no secrets / full user PII in production.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function shouldLogDebug(): boolean {
  return process.env.NODE_ENV !== "production";
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  meta?: Record<string, unknown>
) {
  if (level === "debug" && !shouldLogDebug()) return;
  const payload = meta ? { scope, message, ...meta } : { scope, message };
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...payload });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (scope: string, message: string, meta?: Record<string, unknown>) =>
    emit("debug", scope, message, meta),
  info: (scope: string, message: string, meta?: Record<string, unknown>) =>
    emit("info", scope, message, meta),
  warn: (scope: string, message: string, meta?: Record<string, unknown>) =>
    emit("warn", scope, message, meta),
  error: (scope: string, message: string, meta?: Record<string, unknown>) =>
    emit("error", scope, message, meta),
};

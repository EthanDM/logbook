export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEvent {
  ts: number;
  level: LogLevel;
  name: string;
  deviceId?: string;
  sessionId?: string;
  flowId?: string;
  screen?: string;
  msg?: string;
  payload?: unknown;
}

export interface LogEventRow {
  id: number;
  ts: number;
  level: LogLevel;
  name: string;
  deviceId: string | null;
  sessionId: string | null;
  flowId: string | null;
  screen: string | null;
  msg: string | null;
  payloadJson: string | null;
}

export interface QueryEventsFilters {
  sinceTs?: number;
  untilTs?: number;
  levels?: LogLevel[];
  name?: string;
  deviceId?: string;
  sessionId?: string;
  flowId?: string;
  screen?: string;
  limit?: number;
  order?: "asc" | "desc";
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && LOG_LEVELS.includes(value as LogLevel);
}


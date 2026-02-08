import Fastify, { type FastifyInstance } from "fastify";
import { isLogLevel, type LogEvent } from "@logbook/core";
import { createLogbookDatabase, type LogbookDatabase } from "../db/database.js";
import { resolveDefaultDbPath } from "../db/db-path.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_RETENTION_HOURS = 24;
const DEFAULT_MAX_ROWS = 200_000;
const DEFAULT_FLUSH_INTERVAL_MS = 250;
const DEFAULT_FLUSH_BATCH_SIZE = 200;
const DEFAULT_FLUSH_QUEUE_THRESHOLD = 200;
const DEFAULT_MAX_QUEUE_SIZE = 50_000;
const DEFAULT_RETENTION_INTERVAL_MS = 60_000;
const DEFAULT_REDACT_KEYS = ["email", "token", "authorization", "password"];
const REDACTED_VALUE = "[REDACTED]";

type DropPolicy = "drop_oldest";

export interface CollectorConfig {
  host: string;
  port: number;
  dbPath: string;
  retentionHours: number;
  maxRows: number;
  flushIntervalMs: number;
  flushBatchSize: number;
  flushQueueThreshold: number;
  maxQueueSize: number;
  retentionIntervalMs: number;
  dropPolicy: DropPolicy;
  redactKeys: string[];
}

export interface CollectorOptions {
  host?: string;
  port?: number;
  dbPath?: string;
  retentionHours?: number;
  maxRows?: number;
  flushIntervalMs?: number;
  flushBatchSize?: number;
  flushQueueThreshold?: number;
  maxQueueSize?: number;
  retentionIntervalMs?: number;
  redactKeys?: string[];
}

export interface CollectorServer {
  app: FastifyInstance;
  config: CollectorConfig;
  close: () => Promise<void>;
}

interface QueueStats {
  droppedEvents: number;
  acceptedEvents: number;
  flushFailures: number;
  retentionFailures: number;
}

interface ParseResult {
  ok: true;
  events: LogEvent[];
}

interface ParseError {
  ok: false;
  error: string;
}

type ParsedEvent = { ok: true; event: LogEvent } | ParseError;

class CollectorRuntime {
  private readonly db: LogbookDatabase;
  private readonly config: CollectorConfig;
  private readonly redactKeySet: ReadonlySet<string>;
  private readonly queue: LogEvent[] = [];
  private readonly stats: QueueStats = {
    droppedEvents: 0,
    acceptedEvents: 0,
    flushFailures: 0,
    retentionFailures: 0,
  };

  private flushTimer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;
  private flushInProgress = false;
  private isStopped = false;

  constructor(db: LogbookDatabase, config: CollectorConfig) {
    this.db = db;
    this.config = config;
    this.redactKeySet = new Set(config.redactKeys.map((key) => key.toLowerCase()));
  }

  start(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);
    this.flushTimer.unref();

    this.retentionTimer = setInterval(() => {
      this.runRetention();
    }, this.config.retentionIntervalMs);
    this.retentionTimer.unref();
  }

  enqueue(events: LogEvent[]): { accepted: number; dropped: number } {
    for (const rawEvent of events) {
      const event = redactEventPayload(rawEvent, this.redactKeySet);
      if (this.queue.length >= this.config.maxQueueSize) {
        this.queue.shift();
        this.stats.droppedEvents += 1;
      }

      this.queue.push(event);
      this.stats.acceptedEvents += 1;
    }

    if (this.queue.length >= this.config.flushQueueThreshold) {
      queueMicrotask(() => {
        void this.flush();
      });
    }

    return { accepted: events.length, dropped: this.stats.droppedEvents };
  }

  async stop(): Promise<void> {
    if (this.isStopped) {
      return;
    }

    this.isStopped = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }

    await this.flush();
    this.db.close();
  }

  getHealth() {
    return {
      ok: true,
      host: this.config.host,
      port: this.config.port,
      dbPath: this.config.dbPath,
      queue: {
        length: this.queue.length,
        maxSize: this.config.maxQueueSize,
        dropPolicy: this.config.dropPolicy,
      },
      stats: this.stats,
      retention: {
        hours: this.config.retentionHours,
        maxRows: this.config.maxRows,
        intervalMs: this.config.retentionIntervalMs,
      },
      redaction: {
        keys: this.config.redactKeys,
      },
      storage: {
        totalEvents: this.db.getTotalEventsCount(),
      },
    };
  }

  private async flush(): Promise<void> {
    if (this.flushInProgress || this.queue.length === 0) {
      return;
    }

    this.flushInProgress = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, this.config.flushBatchSize);
        this.db.insertEvents(batch);
        this.queue.splice(0, batch.length);
      }
    } catch {
      this.stats.flushFailures += 1;
    } finally {
      this.flushInProgress = false;
    }
  }

  private runRetention(): void {
    try {
      const retentionCutoffMs =
        Date.now() - this.config.retentionHours * 60 * 60 * 1000;
      this.db.deleteOlderThan(retentionCutoffMs);
      this.db.enforceMaxRows(this.config.maxRows);
    } catch {
      this.stats.retentionFailures += 1;
    }
  }
}

export function resolveCollectorConfig(
  options: CollectorOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): CollectorConfig {
  return {
    host: options.host ?? env.LOGBOOK_HOST ?? DEFAULT_HOST,
    port: normalizePositiveInt(options.port, env.LOGBOOK_PORT, DEFAULT_PORT),
    dbPath: options.dbPath ?? env.LOGBOOK_DB_PATH ?? resolveDefaultDbPath(),
    retentionHours: normalizePositiveInt(
      options.retentionHours,
      env.LOGBOOK_RETENTION_HOURS,
      DEFAULT_RETENTION_HOURS,
    ),
    maxRows: normalizePositiveInt(options.maxRows, env.LOGBOOK_MAX_ROWS, DEFAULT_MAX_ROWS),
    flushIntervalMs: normalizePositiveInt(
      options.flushIntervalMs,
      env.LOGBOOK_FLUSH_INTERVAL_MS,
      DEFAULT_FLUSH_INTERVAL_MS,
    ),
    flushBatchSize: normalizePositiveInt(
      options.flushBatchSize,
      env.LOGBOOK_FLUSH_BATCH_SIZE,
      DEFAULT_FLUSH_BATCH_SIZE,
    ),
    flushQueueThreshold: normalizePositiveInt(
      options.flushQueueThreshold,
      env.LOGBOOK_FLUSH_QUEUE_THRESHOLD,
      DEFAULT_FLUSH_QUEUE_THRESHOLD,
    ),
    maxQueueSize: normalizePositiveInt(
      options.maxQueueSize,
      env.LOGBOOK_MAX_QUEUE_SIZE,
      DEFAULT_MAX_QUEUE_SIZE,
    ),
    retentionIntervalMs: normalizePositiveInt(
      options.retentionIntervalMs,
      env.LOGBOOK_RETENTION_INTERVAL_MS,
      DEFAULT_RETENTION_INTERVAL_MS,
    ),
    dropPolicy: "drop_oldest",
    redactKeys: resolveRedactKeys(options.redactKeys, env.LOGBOOK_REDACT_KEYS),
  };
}

export function createCollectorServer(options: CollectorOptions = {}): CollectorServer {
  const config = resolveCollectorConfig(options);
  const db = createLogbookDatabase({ dbPath: config.dbPath });
  const runtime = new CollectorRuntime(db, config);
  const app = Fastify();

  runtime.start();

  app.post("/ingest", async (request, reply) => {
    const parsed = parseIngestBody(request.body);
    if (isParseError(parsed)) {
      return reply.code(400).send({ ok: false, error: parsed.error });
    }

    const result = runtime.enqueue(parsed.events);

    return reply.code(202).send({
      ok: true,
      accepted: result.accepted,
      dropped: result.dropped,
      queueLength: runtime.getHealth().queue.length,
    });
  });

  app.get("/health", async () => {
    return runtime.getHealth();
  });

  app.addHook("onClose", async () => {
    await runtime.stop();
  });

  return {
    app,
    config,
    close: async () => app.close(),
  };
}

export async function startCollector(
  options: CollectorOptions = {},
): Promise<CollectorServer> {
  const server = createCollectorServer(options);

  await server.app.listen({
    host: server.config.host,
    port: server.config.port,
  });

  return server;
}

function normalizePositiveInt(
  explicit: number | undefined,
  envValue: string | undefined,
  fallback: number,
): number {
  if (typeof explicit === "number" && Number.isInteger(explicit) && explicit > 0) {
    return explicit;
  }
  if (envValue) {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function parseIngestBody(body: unknown): ParseResult | ParseError {
  if (Array.isArray(body)) {
    const events: LogEvent[] = [];
    for (const [index, candidate] of body.entries()) {
      const parsed = parseEvent(candidate);
      if (isParseError(parsed)) {
        return { ok: false, error: `Event at index ${index} is invalid: ${parsed.error}` };
      }
      events.push(parsed.event);
    }
    return { ok: true, events };
  }

  const parsed = parseEvent(body);
  if (isParseError(parsed)) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true, events: [parsed.event] };
}

function parseEvent(input: unknown): ParsedEvent {
  if (!isRecord(input)) {
    return { ok: false, error: "Event must be a JSON object." };
  }

  const ts = input.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    return { ok: false, error: "`ts` must be a finite number." };
  }

  const level = input.level;
  if (!isLogLevel(level)) {
    return { ok: false, error: "`level` must be one of debug, info, warn, error." };
  }

  const name = input.name;
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, error: "`name` must be a non-empty string." };
  }

  const optionalStringKeys = [
    "deviceId",
    "sessionId",
    "flowId",
    "screen",
    "msg",
  ] as const;
  const event: LogEvent = { ts, level, name };

  for (const key of optionalStringKeys) {
    const value = input[key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      return { ok: false, error: `\`${key}\` must be a string when provided.` };
    }
    event[key] = value;
  }

  if ("payload" in input) {
    event.payload = input.payload;
  }

  return { ok: true, event };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isParseError(
  value: ParseResult | ParseError | ParsedEvent,
): value is ParseError {
  return value.ok === false;
}

function resolveRedactKeys(
  explicit: string[] | undefined,
  envValue: string | undefined,
): string[] {
  if (explicit !== undefined) {
    return normalizeRedactKeys(explicit);
  }
  if (envValue !== undefined) {
    return normalizeRedactKeys(envValue.split(","));
  }
  return [...DEFAULT_REDACT_KEYS];
}

function normalizeRedactKeys(input: string[]): string[] {
  return [...new Set(input.map((key) => key.trim().toLowerCase()).filter(Boolean))];
}

function redactEventPayload(event: LogEvent, redactKeys: ReadonlySet<string>): LogEvent {
  if (event.payload === undefined || redactKeys.size === 0) {
    return event;
  }

  const redactedPayload = redactValue(event.payload, redactKeys, new WeakSet<object>());
  if (redactedPayload === event.payload) {
    return event;
  }

  return {
    ...event,
    payload: redactedPayload,
  };
}

function redactValue(
  value: unknown,
  redactKeys: ReadonlySet<string>,
  seen: WeakSet<object>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, redactKeys, seen));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (redactKeys.has(key.toLowerCase())) {
      redacted[key] = REDACTED_VALUE;
      continue;
    }
    redacted[key] = redactValue(entry, redactKeys, seen);
  }

  seen.delete(value);
  return redacted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

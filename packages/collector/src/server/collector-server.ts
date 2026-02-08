import Fastify, { type FastifyInstance } from "fastify";
import { setTimeout as sleep } from "node:timers/promises";
import {
  isLogLevel,
  type LogEvent,
  type LogEventRow,
  type LogLevel,
  type QueryEventsFilters,
} from "@logbook/core";
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
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const DEFAULT_EVENTS_LIMIT = 200;
const DEFAULT_FLOW_LIMIT = 2_000;
const DEFAULT_SUMMARY_LIMIT = 50_000;
const DEFAULT_AROUND_WINDOW_MS = 5_000;
const DEFAULT_DEMO_GENERATE_COUNT = 200;
const MAX_DEMO_GENERATE_COUNT = 5_000;
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
  shutdownTimeoutMs: number;
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
  shutdownTimeoutMs?: number;
  redactKeys?: string[];
}

export interface CollectorServer {
  app: FastifyInstance;
  config: CollectorConfig;
  beginShutdown: () => void;
  close: () => Promise<void>;
}

interface QueueStats {
  droppedEvents: number;
  shutdownDroppedEvents: number;
  acceptedEvents: number;
  flushFailures: number;
  retentionFailures: number;
}

interface ErrorSummary {
  atMs: number;
  message: string;
}

interface ParseResult {
  ok: true;
  events: LogEvent[];
}

interface ParseError {
  ok: false;
  error: string;
}

interface ParseValueResult<T> {
  ok: true;
  value: T;
}

interface ParseEventsQueryOptions {
  defaultLimit: number;
  defaultOrder: "asc" | "desc";
  defaultOffset: number;
}

interface ParseEventsQueryResult {
  ok: true;
  filters: QueryEventsFilters;
}

type ParsedEvent = { ok: true; event: LogEvent } | ParseError;

class CollectorRuntime {
  private readonly db: LogbookDatabase;
  private readonly config: CollectorConfig;
  private readonly redactKeySet: ReadonlySet<string>;
  private readonly queue: LogEvent[] = [];
  private readonly stats: QueueStats = {
    droppedEvents: 0,
    shutdownDroppedEvents: 0,
    acceptedEvents: 0,
    flushFailures: 0,
    retentionFailures: 0,
  };

  private flushTimer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;
  private flushInProgress = false;
  private lifecycleState: "running" | "stopping" | "stopped" = "running";
  private readonly startedAtMs = Date.now();
  private shutdownStartedAtMs: number | null = null;
  private lastSuccessfulFlushAtMs: number | null = null;
  private lastSuccessfulRetentionAtMs: number | null = null;
  private lastFlushError: ErrorSummary | null = null;
  private lastRetentionError: ErrorSummary | null = null;
  private stopPromise: Promise<void> | null = null;

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
    if (!this.isAcceptingIngest()) {
      return { accepted: 0, dropped: this.stats.droppedEvents };
    }

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

  isAcceptingIngest(): boolean {
    return this.lifecycleState === "running";
  }

  beginShutdown(): void {
    if (this.lifecycleState !== "running") {
      return;
    }
    this.lifecycleState = "stopping";
    this.shutdownStartedAtMs = Date.now();
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.beginShutdown();
    this.stopPromise = this.stopInternal();
    return this.stopPromise;
  }

  getHealth() {
    return {
      ok: true,
      host: this.config.host,
      port: this.config.port,
      dbPath: this.config.dbPath,
      lifecycle: {
        state: this.lifecycleState,
        startedAtMs: this.startedAtMs,
        shutdownStartedAtMs: this.shutdownStartedAtMs,
        shutdownTimeoutMs: this.config.shutdownTimeoutMs,
        lastSuccessfulFlushAtMs: this.lastSuccessfulFlushAtMs,
        lastSuccessfulRetentionAtMs: this.lastSuccessfulRetentionAtMs,
      },
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
      failures: {
        lastFlushError: this.lastFlushError,
        lastRetentionError: this.lastRetentionError,
      },
      storage: {
        totalEvents: this.db.getTotalEventsCount(),
      },
    };
  }

  private async stopInternal(): Promise<void> {
    this.clearTimers();

    const deadline = Date.now() + this.config.shutdownTimeoutMs;
    while (this.queue.length > 0 && Date.now() < deadline) {
      const before = this.queue.length;
      await this.flush();

      if (this.queue.length === 0) {
        break;
      }

      if (this.queue.length === before) {
        await sleep(25);
      }
    }

    if (this.queue.length > 0) {
      const droppedOnShutdown = this.queue.length;
      this.stats.shutdownDroppedEvents += droppedOnShutdown;
      this.stats.droppedEvents += droppedOnShutdown;
      this.queue.length = 0;
    }

    this.lifecycleState = "stopped";
    this.db.close();
  }

  private clearTimers(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  private async flush(): Promise<void> {
    if (
      this.flushInProgress ||
      this.queue.length === 0 ||
      this.lifecycleState === "stopped"
    ) {
      return;
    }

    this.flushInProgress = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, this.config.flushBatchSize);
        this.db.insertEvents(batch);
        this.queue.splice(0, batch.length);
        this.lastSuccessfulFlushAtMs = Date.now();
        this.lastFlushError = null;
      }
    } catch (error) {
      this.stats.flushFailures += 1;
      this.lastFlushError = summarizeError(error);
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
      this.lastSuccessfulRetentionAtMs = Date.now();
      this.lastRetentionError = null;
    } catch (error) {
      this.stats.retentionFailures += 1;
      this.lastRetentionError = summarizeError(error);
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
    shutdownTimeoutMs: normalizePositiveInt(
      options.shutdownTimeoutMs,
      env.LOGBOOK_SHUTDOWN_TIMEOUT_MS,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
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
    if (!runtime.isAcceptingIngest()) {
      return reply.code(503).send({
        ok: false,
        error: "Collector is shutting down and not accepting new ingest requests.",
      });
    }

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

  app.post("/demo/generate", async (request, reply) => {
    if (!runtime.isAcceptingIngest()) {
      return reply.code(503).send({
        ok: false,
        error: "Collector is shutting down and not accepting new ingest requests.",
      });
    }

    const parsedCount = parseDemoGenerateCount(request.query, request.body);
    if (isParseError(parsedCount)) {
      return reply.code(400).send({ ok: false, error: parsedCount.error });
    }

    const events = generateDemoEvents(parsedCount.value);
    const result = runtime.enqueue(events);

    return reply.code(202).send({
      ok: true,
      generated: events.length,
      accepted: result.accepted,
      dropped: result.dropped,
      queueLength: runtime.getHealth().queue.length,
    });
  });

  app.get("/health", async () => {
    return runtime.getHealth();
  });

  app.get("/events", async (request, reply) => {
    const parsed = parseEventsQuery(request.query, {
      defaultLimit: DEFAULT_EVENTS_LIMIT,
      defaultOrder: "desc",
      defaultOffset: 0,
    });
    if (isParseError(parsed)) {
      return reply.code(400).send({ ok: false, error: parsed.error });
    }

    const rows = db.queryEvents(parsed.filters);
    return {
      ok: true,
      items: rows,
      count: rows.length,
      filters: parsed.filters,
    };
  });

  app.get("/events/:eventId/around", async (request, reply) => {
    const params = toRecord(request.params);
    const query = toRecord(request.query);

    const eventId = parseEventIdParam(params.eventId);
    if (isParseError(eventId)) {
      return reply.code(400).send({ ok: false, error: eventId.error });
    }

    const windowMs = parseWindowMs(query.windowMs);
    if (isParseError(windowMs)) {
      return reply.code(400).send({ ok: false, error: windowMs.error });
    }

    const centerEvent = db.getEventById(eventId.value);
    if (!centerEvent) {
      return reply
        .code(404)
        .send({ ok: false, error: `Event ${eventId.value} was not found.` });
    }

    const rows = db.queryAroundEvent(eventId.value, windowMs.value);
    return {
      ok: true,
      event: centerEvent,
      items: rows,
      count: rows.length,
      windowMs: windowMs.value,
    };
  });

  app.get("/flows/:flowId", async (request, reply) => {
    const params = toRecord(request.params);
    const flowId = typeof params.flowId === "string" ? params.flowId.trim() : "";
    if (!flowId) {
      return reply.code(400).send({ ok: false, error: "`flowId` is required." });
    }

    const parsed = parseEventsQuery(request.query, {
      defaultLimit: DEFAULT_FLOW_LIMIT,
      defaultOrder: "asc",
      defaultOffset: 0,
    });
    if (isParseError(parsed)) {
      return reply.code(400).send({ ok: false, error: parsed.error });
    }

    const rows = db.queryEvents({
      ...parsed.filters,
      flowId,
      order: "asc",
    });
    return {
      ok: true,
      flowId,
      items: rows,
      count: rows.length,
      filters: parsed.filters,
    };
  });

  app.get("/summary", async (request, reply) => {
    const parsed = parseEventsQuery(request.query, {
      defaultLimit: DEFAULT_SUMMARY_LIMIT,
      defaultOrder: "asc",
      defaultOffset: 0,
    });
    if (isParseError(parsed)) {
      return reply.code(400).send({ ok: false, error: parsed.error });
    }

    const rows = db.queryEvents({
      ...parsed.filters,
      order: "asc",
    });

    return {
      ok: true,
      filters: parsed.filters,
      summary: buildSummary(rows),
    };
  });

  app.addHook("onClose", async () => {
    await runtime.stop();
  });

  let closePromise: Promise<void> | null = null;
  const close = async (): Promise<void> => {
    if (closePromise) {
      return closePromise;
    }
    runtime.beginShutdown();
    closePromise = app.close();
    return closePromise;
  };

  return {
    app,
    config,
    beginShutdown: () => runtime.beginShutdown(),
    close,
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

function parseEventsQuery(
  query: unknown,
  options: ParseEventsQueryOptions,
): ParseEventsQueryResult | ParseError {
  const params = toRecord(query);

  const sinceTs = parseTimeFilter(params.since, "since");
  if (isParseError(sinceTs)) {
    return sinceTs;
  }

  const untilTs = parseTimeFilter(params.until, "until");
  if (isParseError(untilTs)) {
    return untilTs;
  }

  const levels = parseLevelsFilter(params.level);
  if (isParseError(levels)) {
    return levels;
  }

  const name = parseOptionalString(params.name, "name");
  if (isParseError(name)) {
    return name;
  }
  const deviceId = parseOptionalString(params.deviceId, "deviceId");
  if (isParseError(deviceId)) {
    return deviceId;
  }
  const sessionId = parseOptionalString(params.sessionId, "sessionId");
  if (isParseError(sessionId)) {
    return sessionId;
  }
  const flowId = parseOptionalString(params.flowId, "flowId");
  if (isParseError(flowId)) {
    return flowId;
  }
  const screen = parseOptionalString(params.screen, "screen");
  if (isParseError(screen)) {
    return screen;
  }

  const limit = parseNonNegativeInt(
    params.limit,
    "limit",
    options.defaultLimit,
    1,
  );
  if (isParseError(limit)) {
    return limit;
  }

  const offset = parseNonNegativeInt(
    params.offset,
    "offset",
    options.defaultOffset,
    0,
  );
  if (isParseError(offset)) {
    return offset;
  }

  const order = parseOrder(params.order, options.defaultOrder);
  if (isParseError(order)) {
    return order;
  }

  return {
    ok: true,
    filters: {
      sinceTs: sinceTs.value,
      untilTs: untilTs.value,
      levels: levels.value,
      name: name.value,
      deviceId: deviceId.value,
      sessionId: sessionId.value,
      flowId: flowId.value,
      screen: screen.value,
      limit: limit.value,
      offset: offset.value,
      order: order.value,
    },
  };
}

function parseTimeFilter(
  value: unknown,
  key: "since" | "until",
): ParseValueResult<number | undefined> | ParseError {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return { ok: true, value };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `\`${key}\` must be a number, duration, or timestamp string.` };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: `\`${key}\` cannot be empty.` };
  }

  if (/^\d+$/.test(trimmed)) {
    const parsedNumeric = Number.parseInt(trimmed, 10);
    return { ok: true, value: parsedNumeric };
  }

  const durationMs = parseDurationToMs(trimmed);
  if (durationMs !== null) {
    return { ok: true, value: Date.now() - durationMs };
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isNaN(parsedDate)) {
    return { ok: false, error: `\`${key}\` must be a valid duration (10m) or timestamp.` };
  }

  return { ok: true, value: parsedDate };
}

function parseLevelsFilter(value: unknown): { ok: true; value: LogLevel[] | undefined } | ParseError {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  const parts = asStringArray(value);
  if (parts === null) {
    return { ok: false, error: "`level` must be a string or array of strings." };
  }

  const items = parts
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.length === 0) {
    return { ok: true, value: undefined };
  }

  const invalid = items.find((item) => !isLogLevel(item));
  if (invalid) {
    return {
      ok: false,
      error: `Invalid level \`${invalid}\`. Expected debug, info, warn, error.`,
    };
  }

  return { ok: true, value: [...new Set(items as LogLevel[])] };
}

function parseOptionalString(
  value: unknown,
  key: string,
): { ok: true; value: string | undefined } | ParseError {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `\`${key}\` must be a string when provided.` };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed === "" ? undefined : trimmed };
}

function parseNonNegativeInt(
  value: unknown,
  key: string,
  fallback: number,
  min: number,
): ParseValueResult<number> | ParseError {
  if (value === undefined) {
    return { ok: true, value: fallback };
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= min) {
    return { ok: true, value };
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (parsed >= min) {
      return { ok: true, value: parsed };
    }
  }
  return { ok: false, error: `\`${key}\` must be an integer >= ${min}.` };
}

function parseOrder(
  value: unknown,
  fallback: "asc" | "desc",
): { ok: true; value: "asc" | "desc" } | ParseError {
  if (value === undefined) {
    return { ok: true, value: fallback };
  }
  if (value === "asc" || value === "desc") {
    return { ok: true, value };
  }
  return { ok: false, error: "`order` must be either `asc` or `desc`." };
}

function parseEventIdParam(value: unknown): ParseValueResult<number> | ParseError {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (parsed > 0) {
      return { ok: true, value: parsed };
    }
  }
  return { ok: false, error: "`eventId` must be a positive integer." };
}

function parseWindowMs(value: unknown): ParseValueResult<number> | ParseError {
  const parsed = parseNonNegativeInt(value, "windowMs", DEFAULT_AROUND_WINDOW_MS, 0);
  if (isParseError(parsed)) {
    return parsed;
  }
  return parsed;
}

function parseDemoGenerateCount(
  query: unknown,
  body: unknown,
): ParseValueResult<number> | ParseError {
  const queryRecord = toRecord(query);
  const bodyRecord = toRecord(body);
  const countValue = bodyRecord.count ?? queryRecord.count;

  const parsed = parseNonNegativeInt(
    countValue,
    "count",
    DEFAULT_DEMO_GENERATE_COUNT,
    1,
  );
  if (isParseError(parsed)) {
    return parsed;
  }
  if (parsed.value > MAX_DEMO_GENERATE_COUNT) {
    return {
      ok: false,
      error: `\`count\` must be <= ${MAX_DEMO_GENERATE_COUNT}.`,
    };
  }

  return parsed;
}

function asStringArray(value: unknown): string[] | null {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return null;
}

function parseDurationToMs(value: string): number | null {
  const match = value.match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) {
    return null;
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const unitMs = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }[unit];

  return amount * unitMs;
}

function buildSummary(rows: LogEventRow[]) {
  const totalEvents = rows.length;
  const uniqueDevices = new Set(rows.map((row) => row.deviceId).filter(Boolean)).size;
  const startTs = rows[0]?.ts ?? null;
  const endTs = rows[rows.length - 1]?.ts ?? null;

  const topEvents = groupCounts(rows, (row) => row.name)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 15)
    .map((item) => ({ name: item.key, count: item.count }));

  const errorGroups = rows
    .filter((row) => row.level === "error")
    .reduce<Map<string, { count: number; lastTs: number }>>((acc, row) => {
      const current = acc.get(row.name);
      if (!current) {
        acc.set(row.name, { count: 1, lastTs: row.ts });
      } else {
        current.count += 1;
        current.lastTs = Math.max(current.lastTs, row.ts);
      }
      return acc;
    }, new Map());

  const errors = [...errorGroups.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs || a.name.localeCompare(b.name));

  const flows = rows
    .filter((row): row is LogEventRow & { flowId: string } => Boolean(row.flowId))
    .reduce<Map<string, { count: number; lastTs: number }>>((acc, row) => {
      const current = acc.get(row.flowId);
      if (!current) {
        acc.set(row.flowId, { count: 1, lastTs: row.ts });
      } else {
        current.count += 1;
        current.lastTs = Math.max(current.lastTs, row.ts);
      }
      return acc;
    }, new Map());

  const recentFlows = [...flows.entries()]
    .map(([flowId, value]) => ({ flowId, ...value }))
    .sort((a, b) => b.lastTs - a.lastTs || a.flowId.localeCompare(b.flowId))
    .slice(0, 10);

  return {
    totals: {
      totalEvents,
      uniqueDevices,
      startTs,
      endTs,
      timeRange:
        startTs !== null && endTs !== null
          ? `${new Date(startTs).toISOString()} -> ${new Date(endTs).toISOString()}`
          : "n/a",
    },
    topEvents,
    errors,
    recentFlows,
  };
}

function groupCounts<T>(
  rows: T[],
  keySelector: (row: T) => string,
): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = keySelector(row);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].map(([key, count]) => ({ key, count }));
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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

function isParseError(value: { ok: boolean }): value is ParseError {
  return value.ok === false;
}

function generateDemoEvents(count: number): LogEvent[] {
  const stages = [
    "ui.tap",
    "api.request",
    "api.response",
    "state.commit",
    "screen.render",
  ] as const;
  const screens = ["Home", "Feed", "Settings", "Profile"] as const;
  const networks = ["wifi", "5g", "lte"] as const;

  const baseTs = Date.now();
  const events: LogEvent[] = [];

  for (let index = 0; index < count; index += 1) {
    const stage = stages[index % stages.length];
    const flowGroup = Math.floor(index / stages.length) + 1;
    const deviceGroup = (index % 4) + 1;
    const isError = stage === "api.response" && index % 13 === 0;
    const isWarn = stage === "api.response" && !isError && index % 7 === 0;
    const level: LogLevel = isError ? "error" : isWarn ? "warn" : "info";

    events.push({
      ts: baseTs + index,
      level,
      name: `demo.${stage}`,
      deviceId: `demo-device-${deviceGroup}`,
      sessionId: `demo-session-${deviceGroup}`,
      flowId: `demo-flow-${String(flowGroup).padStart(4, "0")}`,
      screen: screens[index % screens.length],
      payload: {
        app: "collector-demo",
        stage,
        latencyMs: 25 + ((index * 17) % 500),
        network: networks[index % networks.length],
        batchIndex: index,
      },
      ...(isError
        ? {
          msg: "Synthetic demo error",
        }
        : {}),
    });
  }

  return events;
}

function summarizeError(error: unknown): ErrorSummary {
  if (error instanceof Error) {
    return {
      atMs: Date.now(),
      message: error.message,
    };
  }

  return {
    atMs: Date.now(),
    message: String(error),
  };
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

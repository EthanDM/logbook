import BetterSqlite3 from "better-sqlite3";
import type {
  LogEvent,
  LogEventRow,
  LogLevel,
  QueryEventsFilters,
} from "@logbook/core";
import { ensureDbDirectory, resolveDefaultDbPath } from "./db-path.js";
import { ensureSchema } from "./schema.js";

const DEFAULT_QUERY_LIMIT = 200;
const MAX_QUERY_LIMIT = 200_000;

interface InsertEventParams {
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

interface DbRow {
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

interface DatabaseCountRow {
  count: number;
}

interface EventIdParams {
  eventId: number;
}

export interface LogbookDatabaseOptions {
  dbPath?: string;
}

export class LogbookDatabase {
  readonly dbPath: string;
  private readonly db: BetterSqlite3.Database;
  private readonly insertEventStmt: BetterSqlite3.Statement<InsertEventParams>;
  private readonly insertEventsTx: (events: LogEvent[]) => number;
  private readonly deleteOlderThanStmt: BetterSqlite3.Statement<[number]>;
  private readonly countEventsStmt: BetterSqlite3.Statement<[], DatabaseCountRow>;
  private readonly deleteOldestStmt: BetterSqlite3.Statement<[number]>;

  constructor(options: LogbookDatabaseOptions = {}) {
    this.dbPath = options.dbPath ?? resolveDefaultDbPath();
    ensureDbDirectory(this.dbPath);

    this.db = new BetterSqlite3(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    ensureSchema(this.db);

    this.insertEventStmt = this.db.prepare<InsertEventParams>(`
      INSERT INTO events (
        ts,
        level,
        name,
        device_id,
        session_id,
        flow_id,
        screen,
        msg,
        payload_json
      )
      VALUES (
        @ts,
        @level,
        @name,
        @deviceId,
        @sessionId,
        @flowId,
        @screen,
        @msg,
        @payloadJson
      );
    `);

    this.insertEventsTx = this.db.transaction((events: LogEvent[]): number => {
      let inserted = 0;
      for (const event of events) {
        this.insertEventStmt.run(toInsertParams(event));
        inserted += 1;
      }
      return inserted;
    });

    this.deleteOlderThanStmt = this.db.prepare<[number]>(
      "DELETE FROM events WHERE ts < ?;",
    );
    this.countEventsStmt = this.db.prepare<[], DatabaseCountRow>(
      "SELECT COUNT(*) AS count FROM events;",
    );
    this.deleteOldestStmt = this.db.prepare<[number]>(`
      DELETE FROM events
      WHERE id IN (
        SELECT id
        FROM events
        ORDER BY ts ASC, id ASC
        LIMIT ?
      );
    `);
  }

  insertEvents(events: LogEvent[]): number {
    if (events.length === 0) {
      return 0;
    }
    return this.insertEventsTx(events);
  }

  queryEvents(filters: QueryEventsFilters = {}): LogEventRow[] {
    const params: Array<string | number> = [];
    const where: string[] = [];

    if (typeof filters.sinceTs === "number") {
      where.push("ts >= ?");
      params.push(filters.sinceTs);
    }
    if (typeof filters.untilTs === "number") {
      where.push("ts <= ?");
      params.push(filters.untilTs);
    }
    if (filters.levels && filters.levels.length > 0) {
      const levelPlaceholders = filters.levels.map(() => "?").join(", ");
      where.push(`level IN (${levelPlaceholders})`);
      params.push(...filters.levels);
    }
    if (filters.name) {
      where.push("name LIKE ?");
      params.push(`%${filters.name}%`);
    }
    if (filters.deviceId) {
      where.push("device_id = ?");
      params.push(filters.deviceId);
    }
    if (filters.sessionId) {
      where.push("session_id = ?");
      params.push(filters.sessionId);
    }
    if (filters.flowId) {
      where.push("flow_id = ?");
      params.push(filters.flowId);
    }
    if (filters.screen) {
      where.push("screen = ?");
      params.push(filters.screen);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const orderDirection = filters.order === "asc" ? "ASC" : "DESC";
    const limit = clampLimit(filters.limit);
    const offset = clampOffset(filters.offset);

    const statement = this.db.prepare<Array<string | number>, DbRow>(`
      SELECT
        id,
        ts,
        level,
        name,
        device_id AS deviceId,
        session_id AS sessionId,
        flow_id AS flowId,
        screen,
        msg,
        payload_json AS payloadJson
      FROM events
      ${whereClause}
      ORDER BY ts ${orderDirection}, id ${orderDirection}
      LIMIT ${limit}
      OFFSET ${offset};
    `);

    return statement.all(...params);
  }

  deleteOlderThan(tsMs: number): number {
    return this.deleteOlderThanStmt.run(tsMs).changes;
  }

  enforceMaxRows(maxRows: number): number {
    if (!Number.isInteger(maxRows) || maxRows < 1) {
      throw new Error("maxRows must be a positive integer.");
    }

    const countRow = this.countEventsStmt.get();
    const currentCount = countRow?.count ?? 0;

    if (currentCount <= maxRows) {
      return 0;
    }

    const rowsToDelete = currentCount - maxRows;
    return this.deleteOldestStmt.run(rowsToDelete).changes;
  }

  getTotalEventsCount(): number {
    const countRow = this.countEventsStmt.get();
    return countRow?.count ?? 0;
  }

  getEventById(eventId: number): LogEventRow | undefined {
    const statement = this.db.prepare<EventIdParams, DbRow>(`
      SELECT
        id,
        ts,
        level,
        name,
        device_id AS deviceId,
        session_id AS sessionId,
        flow_id AS flowId,
        screen,
        msg,
        payload_json AS payloadJson
      FROM events
      WHERE id = @eventId
      LIMIT 1;
    `);

    return statement.get({ eventId });
  }

  queryAroundEvent(eventId: number, windowMs: number): LogEventRow[] {
    const event = this.getEventById(eventId);
    if (!event) {
      return [];
    }

    const safeWindowMs = Math.max(0, windowMs);
    const startTs = event.ts - safeWindowMs;
    const endTs = event.ts + safeWindowMs;

    const statement = this.db.prepare<[number, number], DbRow>(`
      SELECT
        id,
        ts,
        level,
        name,
        device_id AS deviceId,
        session_id AS sessionId,
        flow_id AS flowId,
        screen,
        msg,
        payload_json AS payloadJson
      FROM events
      WHERE ts BETWEEN ? AND ?
      ORDER BY ts ASC, id ASC;
    `);

    return statement.all(startTs, endTs);
  }

  close(): void {
    this.db.close();
  }
}

export function createLogbookDatabase(
  options: LogbookDatabaseOptions = {},
): LogbookDatabase {
  return new LogbookDatabase(options);
}

function toInsertParams(event: LogEvent): InsertEventParams {
  return {
    ts: event.ts,
    level: event.level,
    name: event.name,
    deviceId: event.deviceId ?? null,
    sessionId: event.sessionId ?? null,
    flowId: event.flowId ?? null,
    screen: event.screen ?? null,
    msg: event.msg ?? null,
    payloadJson: serializePayload(event.payload),
  };
}

function serializePayload(payload: unknown): string | null {
  if (payload === undefined) {
    return null;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      __logbookError: "Payload is not JSON-serializable.",
    });
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_QUERY_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    return DEFAULT_QUERY_LIMIT;
  }
  return Math.min(limit, MAX_QUERY_LIMIT);
}

function clampOffset(offset: number | undefined): number {
  if (!Number.isInteger(offset) || offset === undefined || offset < 0) {
    return 0;
  }
  return offset;
}

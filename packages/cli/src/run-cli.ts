import { networkInterfaces } from "node:os";
import { setInterval, clearInterval } from "node:timers";
import { cac } from "cac";
import {
  LogbookDatabase,
  resolveDefaultDbPath,
  startCollector,
  type CollectorOptions,
} from "@logbook/collector";
import type { LogEventRow, LogLevel, QueryEventsFilters } from "@logbook/core";

const DEFAULT_TAIL_LIMIT = 50;
const DEFAULT_FIND_LIMIT = 200;
const FOLLOW_POLL_INTERVAL_MS = 500;

interface CommonQueryOptions {
  level?: string;
  name?: string;
  device?: string;
  flow?: string;
  screen?: string;
  limit?: string | number;
}

interface LastSeen {
  ts: number;
  id: number;
}

export async function runCli(argv = process.argv): Promise<void> {
  const cli = cac("logbook");

  cli
    .command("dev", "Start the local collector")
    .option("--host <host>", "Host to bind", { default: "127.0.0.1" })
    .option("--port <port>", "Port to bind", { default: "8787" })
    .option("--db <path>", "SQLite DB path")
    .action(async (options) => {
      const collectorOptions: CollectorOptions = {
        host: options.host,
        port: Number(options.port),
        dbPath: options.db,
      };

      const server = await startCollector(collectorOptions);
      const localUrl = `http://${server.config.host}:${server.config.port}`;

      process.stdout.write(`Collector started\n`);
      process.stdout.write(`Local URL: ${localUrl}\n`);
      process.stdout.write(`Ingest: ${localUrl}/ingest\n`);
      process.stdout.write(`Health: ${localUrl}/health\n`);

      const lanUrls = getLanUrls(server.config.port);
      if (lanUrls.length > 0) {
        process.stdout.write(`LAN ingest URLs:\n`);
        for (const url of lanUrls) {
          process.stdout.write(`- ${url}/ingest\n`);
        }
      } else {
        process.stdout.write(`LAN ingest URLs: use your machine LAN IP and port ${server.config.port}\n`);
      }

      await waitForSignal();
      await server.close();
    });

  cli
    .command("tail", "Show recent events")
    .option("--db <path>", "SQLite DB path")
    .option("--level <levels>", "Comma-separated levels")
    .option("--name <name>", "Name substring filter")
    .option("--device <deviceId>", "Device ID filter")
    .option("--flow <flowId>", "Flow ID filter")
    .option("--screen <screen>", "Screen filter")
    .option("--limit <count>", "Result limit", { default: String(DEFAULT_TAIL_LIMIT) })
    .option("--json", "Print NDJSON output")
    .option("--follow", "Poll for new rows every 500ms")
    .action(async (options) => {
      const db = openDatabase(options.db);
      const filters = buildQueryFilters(options);
      const limit = parsePositiveInt(options.limit, DEFAULT_TAIL_LIMIT);

      const initialRows = db
        .queryEvents({ ...filters, order: "desc", limit })
        .slice()
        .reverse();

      writeRows(initialRows, Boolean(options.json));

      if (!options.follow) {
        db.close();
        return;
      }

      let lastSeen = getLastSeen(initialRows);
      const pollId = setInterval(() => {
        const rows = db.queryEvents({
          ...filters,
          order: "asc",
          sinceTs: lastSeen?.ts,
          limit: 2000,
        });

        const unseen = rows.filter((row) => isAfterLastSeen(row, lastSeen));
        if (unseen.length > 0) {
          writeRows(unseen, Boolean(options.json));
          lastSeen = getLastSeen(unseen);
        }
      }, FOLLOW_POLL_INTERVAL_MS);

      await waitForSignal();
      clearInterval(pollId);
      db.close();
    });

  cli
    .command("find", "Query historical events")
    .option("--db <path>", "SQLite DB path")
    .option("--since <value>", "Relative (10m, 1h) or ISO timestamp")
    .option("--until <value>", "Relative (10m, 1h) or ISO timestamp")
    .option("--level <levels>", "Comma-separated levels")
    .option("--name <name>", "Name substring filter")
    .option("--device <deviceId>", "Device ID filter")
    .option("--flow <flowId>", "Flow ID filter")
    .option("--screen <screen>", "Screen filter")
    .option("--limit <count>", "Result limit", { default: String(DEFAULT_FIND_LIMIT) })
    .option("--json", "Print NDJSON output")
    .action(async (options) => {
      const db = openDatabase(options.db);
      const filters = buildQueryFilters(options);
      const limit = parsePositiveInt(options.limit, DEFAULT_FIND_LIMIT);
      const sinceTs = parseTimeOrUndefined(options.since);
      const untilTs = parseTimeOrUndefined(options.until);

      const rows = db.queryEvents({
        ...filters,
        sinceTs,
        untilTs,
        limit,
        order: "asc",
      });

      writeRows(rows, Boolean(options.json));
      db.close();
    });

  cli
    .command("flow <flowId>", "Show events for a flow")
    .option("--db <path>", "SQLite DB path")
    .option("--since <value>", "Relative (10m, 1h) or ISO timestamp")
    .option("--limit <count>", "Result limit", { default: "2000" })
    .option("--json", "Print NDJSON output")
    .action(async (flowId, options) => {
      const db = openDatabase(options.db);
      const sinceTs = parseTimeOrUndefined(options.since);
      const limit = parsePositiveInt(options.limit, 2000);

      const rows = db.queryEvents({
        flowId,
        sinceTs,
        limit,
        order: "asc",
      });
      writeRows(rows, Boolean(options.json));
      db.close();
    });

  cli
    .command("around <eventId>", "Show events around a specific event")
    .option("--db <path>", "SQLite DB path")
    .option("--window <value>", "Relative duration (default 5s)", { default: "5s" })
    .option("--json", "Print NDJSON output")
    .action(async (eventId, options) => {
      const db = openDatabase(options.db);
      const parsedEventId = Number.parseInt(eventId, 10);
      if (!Number.isInteger(parsedEventId) || parsedEventId < 1) {
        throw new Error("eventId must be a positive integer.");
      }

      const windowMs = parseDurationToMs(options.window);
      const rows = db.queryAroundEvent(parsedEventId, windowMs);
      writeRows(rows, Boolean(options.json));
      db.close();
    });

  cli
    .command("summary", "Print deterministic summary for a time window")
    .option("--db <path>", "SQLite DB path")
    .option("--since <value>", "Relative (10m, 1h) or ISO timestamp", {
      default: "5m",
    })
    .option("--until <value>", "Relative (10m, 1h) or ISO timestamp")
    .option("--level <levels>", "Comma-separated levels")
    .option("--name <name>", "Name substring filter")
    .option("--device <deviceId>", "Device ID filter")
    .option("--flow <flowId>", "Flow ID filter")
    .option("--screen <screen>", "Screen filter")
    .option("--limit <count>", "Result limit", { default: "50000" })
    .option("--md", "Markdown output")
    .action(async (options) => {
      const db = openDatabase(options.db);
      const filters = buildQueryFilters(options);
      const sinceTs = parseTimeOrUndefined(options.since) ?? Date.now() - 5 * 60_000;
      const untilTs = parseTimeOrUndefined(options.until);
      const limit = parsePositiveInt(options.limit, 50_000);

      const rows = db.queryEvents({
        ...filters,
        sinceTs,
        untilTs,
        limit,
        order: "asc",
      });

      writeSummary(rows, Boolean(options.md));
      db.close();
    });

  cli.help();
  cli.version("0.1.0");
  await cli.parse(argv, { run: true });
}

function openDatabase(dbPath: string | undefined): LogbookDatabase {
  return new LogbookDatabase({
    dbPath: dbPath ?? resolveDefaultDbPath(),
  });
}

function buildQueryFilters(options: CommonQueryOptions): QueryEventsFilters {
  return {
    levels: parseLevels(options.level),
    name: options.name,
    deviceId: options.device,
    flowId: options.flow,
    screen: options.screen,
  };
}

function parseLevels(value: string | undefined): LogLevel[] | undefined {
  if (!value) {
    return undefined;
  }

  const levels = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item): item is LogLevel =>
      ["debug", "info", "warn", "error"].includes(item),
    );

  return levels.length > 0 ? levels : undefined;
}

function parsePositiveInt(value: string | number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

function parseTimeOrUndefined(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const durationMs = parseDurationToMs(value);
  if (durationMs >= 0) {
    return Date.now() - durationMs;
  }

  const parsedDate = Date.parse(value);
  if (Number.isNaN(parsedDate)) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return parsedDate;
}

function parseDurationToMs(value: string): number {
  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)$/i);
  if (!match) {
    return -1;
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const unitMs = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }[unit];
  return amount * unitMs;
}

function writeRows(rows: LogEventRow[], json: boolean): void {
  if (json) {
    for (const row of rows) {
      process.stdout.write(`${JSON.stringify(row)}\n`);
    }
    return;
  }

  for (const row of rows) {
    process.stdout.write(`${formatRow(row)}\n`);
  }
}

function formatRow(row: LogEventRow): string {
  const timestamp = formatTimestamp(row.ts);
  const context: string[] = [];
  if (row.deviceId) context.push(`device=${row.deviceId}`);
  if (row.sessionId) context.push(`session=${row.sessionId}`);
  if (row.flowId) context.push(`flow=${row.flowId}`);

  const contextText = context.length > 0 ? ` [${context.join(" ")}]` : "";
  const payloadSummary = summarizePayload(row);

  return `${timestamp} ${row.level} ${row.name}${contextText} ${payloadSummary}`.trim();
}

function summarizePayload(row: LogEventRow): string {
  if (row.msg) {
    return row.msg;
  }
  if (!row.payloadJson) {
    return "";
  }
  return truncate(row.payloadJson, 160);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const mmm = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${mmm}`;
}

function getLastSeen(rows: LogEventRow[]): LastSeen | null {
  const row = rows.at(-1);
  if (!row) {
    return null;
  }
  return { ts: row.ts, id: row.id };
}

function isAfterLastSeen(row: LogEventRow, lastSeen: LastSeen | null): boolean {
  if (!lastSeen) {
    return true;
  }
  if (row.ts > lastSeen.ts) {
    return true;
  }
  if (row.ts === lastSeen.ts && row.id > lastSeen.id) {
    return true;
  }
  return false;
}

function writeSummary(rows: LogEventRow[], markdown: boolean): void {
  const totalEvents = rows.length;
  const uniqueDevices = new Set(rows.map((row) => row.deviceId).filter(Boolean)).size;
  const firstTs = rows[0]?.ts;
  const lastTs = rows[rows.length - 1]?.ts;

  const topEvents = groupCounts(rows, (row) => row.name)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 15);

  const errors = rows
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

  const errorGroups = [...errors.entries()]
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

  if (markdown) {
    process.stdout.write(`## Logbook Summary\n`);
    process.stdout.write(`### 1. Totals\n`);
    process.stdout.write(`- Total events: ${totalEvents}\n`);
    process.stdout.write(`- Unique devices: ${uniqueDevices}\n`);
    process.stdout.write(`- Time range: ${formatRange(firstTs, lastTs)}\n`);
    process.stdout.write(`### 2. Top Events\n`);
    for (const item of topEvents) {
      process.stdout.write(`- ${item.key}: ${item.count}\n`);
    }
    process.stdout.write(`### 3. Errors\n`);
    for (const item of errorGroups) {
      process.stdout.write(`- ${item.name}: ${item.count} (last ${formatTimestamp(item.lastTs)})\n`);
    }
    process.stdout.write(`### 4. Recent Flows\n`);
    for (const item of recentFlows) {
      process.stdout.write(
        `- ${item.flowId}: ${item.count} events (last ${formatTimestamp(item.lastTs)})\n`,
      );
    }
    return;
  }

  process.stdout.write(`1) Totals\n`);
  process.stdout.write(`total_events=${totalEvents}\n`);
  process.stdout.write(`unique_devices=${uniqueDevices}\n`);
  process.stdout.write(`time_range=${formatRange(firstTs, lastTs)}\n`);
  process.stdout.write(`2) Top Events\n`);
  for (const item of topEvents) {
    process.stdout.write(`${item.key} ${item.count}\n`);
  }
  process.stdout.write(`3) Errors\n`);
  for (const item of errorGroups) {
    process.stdout.write(`${item.name} ${item.count} last=${formatTimestamp(item.lastTs)}\n`);
  }
  process.stdout.write(`4) Recent Flows\n`);
  for (const item of recentFlows) {
    process.stdout.write(
      `${item.flowId} count=${item.count} last=${formatTimestamp(item.lastTs)}\n`,
    );
  }
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

function formatRange(startTs: number | undefined, endTs: number | undefined): string {
  if (startTs === undefined || endTs === undefined) {
    return "n/a";
  }
  return `${new Date(startTs).toISOString()} -> ${new Date(endTs).toISOString()}`;
}

function getLanUrls(port: number): string[] {
  const entries = Object.values(networkInterfaces()).flat().filter(Boolean);
  const urls: string[] = [];

  for (const entry of entries) {
    if (!entry || entry.family !== "IPv4" || entry.internal) {
      continue;
    }
    urls.push(`http://${entry.address}:${port}`);
  }

  return [...new Set(urls)].sort();
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const onSignal = () => {
      if (settled) {
        return;
      }
      settled = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };

    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}


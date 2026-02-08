import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LogbookDatabase } from "../src/db/database.js";
import {
  createCollectorServer,
  resolveCollectorConfig,
  startCollector,
} from "../src/server/collector-server.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to resolve ephemeral port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

test("GET /health returns collector status payload", async () => {
  const root = createTempDir("logbook-collector-health-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 10,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const response = await server.app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    ok: boolean;
    dbPath: string;
    lifecycle: {
      state: "running" | "stopping" | "stopped";
      startedAtMs: number;
      shutdownStartedAtMs: number | null;
      shutdownTimeoutMs: number;
      lastSuccessfulFlushAtMs: number | null;
      lastSuccessfulRetentionAtMs: number | null;
    };
    failures: {
      lastFlushError: { atMs: number; message: string } | null;
      lastRetentionError: { atMs: number; message: string } | null;
    };
    stats: {
      shutdownDroppedEvents: number;
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.dbPath, dbPath);
  assert.equal(body.lifecycle.state, "running");
  assert.equal(typeof body.lifecycle.startedAtMs, "number");
  assert.equal(body.lifecycle.shutdownStartedAtMs, null);
  assert.equal(body.lifecycle.shutdownTimeoutMs, 5_000);
  assert.equal(body.lifecycle.lastSuccessfulFlushAtMs, null);
  assert.equal(body.lifecycle.lastSuccessfulRetentionAtMs, null);
  assert.equal(body.failures.lastFlushError, null);
  assert.equal(body.failures.lastRetentionError, null);
  assert.equal(body.stats.shutdownDroppedEvents, 0);

  await server.close();
  cleanupDir(root);
});

test("GET /health payload keeps deterministic top-level key order", async () => {
  const root = createTempDir("logbook-collector-health-keys-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({ dbPath });

  await server.app.ready();
  const response = await server.app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), [
    "ok",
    "host",
    "port",
    "dbPath",
    "lifecycle",
    "queue",
    "stats",
    "retention",
    "redaction",
    "failures",
    "storage",
  ]);

  await server.close();
  cleanupDir(root);
});

test("POST /ingest rejects invalid payload with 400", async () => {
  const root = createTempDir("logbook-collector-invalid-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({ dbPath });

  await server.app.ready();
  const response = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload: { level: "info", name: "demo.missing_ts" },
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.match(body.error, /`ts`/);

  await server.close();
  cleanupDir(root);
});

test("POST /ingest returns 503 once shutdown begins", async () => {
  const root = createTempDir("logbook-collector-shutdown-reject-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({ dbPath });

  await server.app.ready();
  server.beginShutdown();

  const response = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload: {
      ts: Date.now(),
      level: "info",
      name: "demo.shutdown.reject",
    },
  });

  assert.equal(response.statusCode, 503);
  const body = response.json() as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.match(body.error, /shutting down/i);

  await server.close();
  cleanupDir(root);
});

test("POST /ingest accepts events and persists after async flush", async () => {
  const root = createTempDir("logbook-collector-ingest-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushBatchSize: 20,
    flushQueueThreshold: 1,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const ingestResponse = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload: {
      ts: Date.now(),
      level: "info",
      name: "demo.hello",
      payload: { x: 1 },
    },
  });

  assert.equal(ingestResponse.statusCode, 202);
  await sleep(20);

  const healthResponse = await server.app.inject({
    method: "GET",
    url: "/health",
  });
  const healthBody = healthResponse.json() as {
    storage: { totalEvents: number };
  };
  assert.equal(healthResponse.statusCode, 200);
  assert.ok(healthBody.storage.totalEvents >= 1);

  await server.close();
  cleanupDir(root);
});

test("POST /demo/generate enqueues synthetic events", async () => {
  const root = createTempDir("logbook-collector-demo-generate-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushQueueThreshold: 1,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const response = await server.app.inject({
    method: "POST",
    url: "/demo/generate",
    payload: {
      count: 40,
    },
  });
  assert.equal(response.statusCode, 202);
  const body = response.json() as {
    ok: boolean;
    generated: number;
    accepted: number;
  };
  assert.equal(body.ok, true);
  assert.equal(body.generated, 40);
  assert.equal(body.accepted, 40);

  await sleep(50);
  const db = new LogbookDatabase({ dbPath });
  const rows = db.queryEvents({ name: "demo.ui.tap", limit: 10 });
  assert.ok(rows.length >= 1);
  db.close();

  await server.close();
  cleanupDir(root);
});

test("POST /demo/generate validates count bounds", async () => {
  const root = createTempDir("logbook-collector-demo-generate-invalid-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({ dbPath });

  await server.app.ready();
  const response = await server.app.inject({
    method: "POST",
    url: "/demo/generate",
    payload: {
      count: 9000,
    },
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { ok: boolean; error: string };
  assert.equal(body.ok, false);
  assert.match(body.error, /count/);

  await server.close();
  cleanupDir(root);
});

test("GET /events supports filtering, order, limit, and offset", async () => {
  const root = createTempDir("logbook-collector-events-route-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushQueueThreshold: 1,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const now = Date.now();
  const payload = [
    { ts: now + 1, level: "info", name: "demo.events", flowId: "flow-a" },
    { ts: now + 2, level: "error", name: "demo.events", flowId: "flow-a" },
    { ts: now + 3, level: "warn", name: "demo.events", flowId: "flow-b" },
    { ts: now + 4, level: "error", name: "demo.events", flowId: "flow-a" },
  ];

  const ingest = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload,
  });
  assert.equal(ingest.statusCode, 202);
  await sleep(30);

  const response = await server.app.inject({
    method: "GET",
    url: "/events?level=error&order=asc&limit=1&offset=1",
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    ok: boolean;
    count: number;
    items: Array<{ level: string; ts: number }>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.count, 1);
  assert.equal(body.items[0]?.level, "error");
  assert.equal(body.items[0]?.ts, now + 4);

  await server.close();
  cleanupDir(root);
});

test("GET /events/:eventId/around returns context and 404 for unknown event", async () => {
  const root = createTempDir("logbook-collector-events-around-route-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushQueueThreshold: 1,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const now = Date.now();
  const payload = [
    { ts: now, level: "info", name: "demo.a" },
    { ts: now + 10, level: "info", name: "demo.b" },
    { ts: now + 20, level: "info", name: "demo.c" },
  ];
  const ingest = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload,
  });
  assert.equal(ingest.statusCode, 202);
  await sleep(30);

  const db = new LogbookDatabase({ dbPath });
  const middle = db.queryEvents({ name: "demo.b", limit: 1 })[0];
  db.close();
  assert.ok(middle);

  const around = await server.app.inject({
    method: "GET",
    url: `/events/${middle.id}/around?windowMs=11`,
  });
  assert.equal(around.statusCode, 200);
  const aroundBody = around.json() as {
    ok: boolean;
    count: number;
    items: Array<{ name: string }>;
  };
  assert.equal(aroundBody.ok, true);
  assert.equal(aroundBody.count, 3);
  assert.deepEqual(aroundBody.items.map((item) => item.name), ["demo.a", "demo.b", "demo.c"]);

  const missing = await server.app.inject({
    method: "GET",
    url: "/events/999999/around",
  });
  assert.equal(missing.statusCode, 404);

  await server.close();
  cleanupDir(root);
});

test("GET /flows/:flowId returns ordered timeline", async () => {
  const root = createTempDir("logbook-collector-flow-route-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushQueueThreshold: 1,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const now = Date.now();
  const payload = [
    { ts: now + 20, level: "info", name: "demo.flow.late", flowId: "flow-42" },
    { ts: now + 10, level: "info", name: "demo.flow.early", flowId: "flow-42" },
    { ts: now + 30, level: "info", name: "demo.other", flowId: "flow-other" },
  ];
  const ingest = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload,
  });
  assert.equal(ingest.statusCode, 202);
  await sleep(30);

  const response = await server.app.inject({
    method: "GET",
    url: "/flows/flow-42",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    ok: boolean;
    items: Array<{ name: string; flowId: string | null }>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.items.length, 2);
  assert.deepEqual(body.items.map((item) => item.name), ["demo.flow.early", "demo.flow.late"]);
  assert.ok(body.items.every((item) => item.flowId === "flow-42"));

  await server.close();
  cleanupDir(root);
});

test("GET /summary returns deterministic aggregate sections", async () => {
  const root = createTempDir("logbook-collector-summary-route-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushQueueThreshold: 1,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const now = Date.now();
  const payload = [
    { ts: now + 1, level: "info", name: "demo.open", deviceId: "ios-1", flowId: "flow-a" },
    { ts: now + 2, level: "error", name: "demo.fail", deviceId: "ios-1", flowId: "flow-a" },
    { ts: now + 3, level: "error", name: "demo.fail", deviceId: "android-1", flowId: "flow-b" },
    { ts: now + 4, level: "info", name: "demo.open", deviceId: "android-1", flowId: "flow-b" },
  ];
  const ingest = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload,
  });
  assert.equal(ingest.statusCode, 202);
  await sleep(30);

  const response = await server.app.inject({
    method: "GET",
    url: "/summary?since=1h",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    ok: boolean;
    summary: {
      totals: { totalEvents: number; uniqueDevices: number };
      topEvents: Array<{ name: string; count: number }>;
      errors: Array<{ name: string; count: number }>;
      recentFlows: Array<{ flowId: string; count: number }>;
    };
  };
  assert.equal(body.ok, true);
  assert.equal(body.summary.totals.totalEvents, 4);
  assert.equal(body.summary.totals.uniqueDevices, 2);
  assert.deepEqual(body.summary.topEvents[0], { name: "demo.fail", count: 2 });
  assert.deepEqual(body.summary.errors[0], { name: "demo.fail", count: 2, lastTs: now + 3 });
  assert.deepEqual(body.summary.recentFlows[0], { flowId: "flow-b", count: 2, lastTs: now + 4 });

  await server.close();
  cleanupDir(root);
});

test("queue backpressure drops oldest events when max queue is exceeded", async () => {
  const root = createTempDir("logbook-collector-backpressure-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 10_000,
    flushQueueThreshold: 10_000,
    maxQueueSize: 100,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const payload = Array.from({ length: 500 }, (_, index) => ({
    ts: Date.now() + index,
    level: "info" as const,
    name: "demo.bulk",
  }));

  const response = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload,
  });

  assert.equal(response.statusCode, 202);
  const body = response.json() as {
    accepted: number;
    dropped: number;
    queueLength: number;
  };
  assert.equal(body.accepted, 500);
  assert.ok(body.dropped > 0);
  assert.ok(body.queueLength <= 100);

  await server.close();
  cleanupDir(root);
});

test("retention loop enforces max rows automatically", async () => {
  const root = createTempDir("logbook-collector-retention-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushQueueThreshold: 1,
    retentionIntervalMs: 10,
    retentionHours: 24,
    maxRows: 3,
  });

  await server.app.ready();

  const now = Date.now();
  const payload = Array.from({ length: 10 }, (_, index) => ({
    ts: now + index,
    level: "info" as const,
    name: `demo.${index}`,
  }));
  const response = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload,
  });
  assert.equal(response.statusCode, 202);

  await sleep(80);

  const healthResponse = await server.app.inject({
    method: "GET",
    url: "/health",
  });
  const healthBody = healthResponse.json() as {
    storage: { totalEvents: number };
  };
  assert.ok(healthBody.storage.totalEvents <= 3);

  await server.close();
  cleanupDir(root);
});

test("collector redacts default sensitive keys in payload before persistence", async () => {
  const root = createTempDir("logbook-collector-redaction-default-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushQueueThreshold: 1,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const response = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload: {
      ts: Date.now(),
      level: "info",
      name: "demo.redaction.default",
      payload: {
        email: "dev@example.com",
        token: "abcd",
        nested: { authorization: "Bearer x", password: "secret", safe: "ok" },
      },
    },
  });
  assert.equal(response.statusCode, 202);

  await sleep(20);
  await server.close();

  const db = new LogbookDatabase({ dbPath });
  const row = db.queryEvents({ name: "demo.redaction.default", limit: 1 })[0];
  assert.ok(row);
  assert.ok(row.payloadJson);

  const payload = JSON.parse(row.payloadJson);
  assert.equal(payload.email, "[REDACTED]");
  assert.equal(payload.token, "[REDACTED]");
  assert.equal(payload.nested.authorization, "[REDACTED]");
  assert.equal(payload.nested.password, "[REDACTED]");
  assert.equal(payload.nested.safe, "ok");

  db.close();
  cleanupDir(root);
});

test("collector supports custom redaction keys via LOGBOOK_REDACT_KEYS", async () => {
  const config = resolveCollectorConfig(
    {},
    {
      LOGBOOK_REDACT_KEYS: "apiKey,secret",
    } as NodeJS.ProcessEnv,
  );
  assert.deepEqual(config.redactKeys, ["apikey", "secret"]);

  const root = createTempDir("logbook-collector-redaction-custom-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushQueueThreshold: 1,
    retentionIntervalMs: 30_000,
    redactKeys: ["apiKey", "secret"],
  });

  await server.app.ready();
  const response = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload: {
      ts: Date.now(),
      level: "info",
      name: "demo.redaction.custom",
      payload: {
        apiKey: "live-key",
        secret: "super-secret",
        token: "leave-visible",
      },
    },
  });
  assert.equal(response.statusCode, 202);

  await sleep(20);
  await server.close();

  const db = new LogbookDatabase({ dbPath });
  const row = db.queryEvents({ name: "demo.redaction.custom", limit: 1 })[0];
  assert.ok(row);
  assert.ok(row.payloadJson);

  const payload = JSON.parse(row.payloadJson);
  assert.equal(payload.apiKey, "[REDACTED]");
  assert.equal(payload.secret, "[REDACTED]");
  assert.equal(payload.token, "leave-visible");

  db.close();
  cleanupDir(root);
});

test("server close flushes queued events before shutdown", async () => {
  const root = createTempDir("logbook-collector-shutdown-flush-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 10_000,
    flushQueueThreshold: 10_000,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const response = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload: {
      ts: Date.now(),
      level: "info",
      name: "demo.shutdown.flush",
    },
  });
  assert.equal(response.statusCode, 202);

  await server.close();

  const db = new LogbookDatabase({ dbPath });
  const rows = db.queryEvents({ name: "demo.shutdown.flush", limit: 10 });
  assert.equal(rows.length, 1);
  db.close();

  cleanupDir(root);
});

test("server close is idempotent when called repeatedly", async () => {
  const root = createTempDir("logbook-collector-close-idempotent-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 10_000,
    flushQueueThreshold: 10_000,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const response = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload: {
      ts: Date.now(),
      level: "info",
      name: "demo.close.repeat",
    },
  });
  assert.equal(response.statusCode, 202);

  await Promise.all([server.close(), server.close(), server.close()]);

  const db = new LogbookDatabase({ dbPath });
  const rows = db.queryEvents({ name: "demo.close.repeat", limit: 10 });
  assert.equal(rows.length, 1);
  db.close();

  cleanupDir(root);
});

test("startCollector smoke test serves /health over HTTP", async () => {
  const root = createTempDir("logbook-collector-smoke-http-");
  const dbPath = join(root, "logs.db");
  const port = await reservePort();
  const server = await startCollector({
    host: "127.0.0.1",
    port,
    dbPath,
    retentionIntervalMs: 30_000,
  });

  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; dbPath: string };
  assert.equal(body.ok, true);
  assert.equal(body.dbPath, dbPath);

  await server.close();
  cleanupDir(root);
});

test("collector handles large ingest batches without flush failures", async () => {
  const root = createTempDir("logbook-collector-perf-");
  const dbPath = join(root, "logs.db");
  const server = createCollectorServer({
    dbPath,
    flushIntervalMs: 5,
    flushBatchSize: 500,
    flushQueueThreshold: 500,
    retentionIntervalMs: 30_000,
  });

  await server.app.ready();
  const now = Date.now();
  const payload = Array.from({ length: 5_000 }, (_, index) => ({
    ts: now + index,
    level: "info" as const,
    name: "demo.perf",
  }));

  const response = await server.app.inject({
    method: "POST",
    url: "/ingest",
    payload,
  });
  assert.equal(response.statusCode, 202);

  await sleep(150);
  const health = await server.app.inject({
    method: "GET",
    url: "/health",
  });
  const healthBody = health.json() as {
    stats: { flushFailures: number };
    storage: { totalEvents: number };
  };
  assert.equal(healthBody.stats.flushFailures, 0);
  assert.equal(healthBody.storage.totalEvents, 5_000);

  await server.close();
  cleanupDir(root);
});

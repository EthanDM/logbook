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
  const body = response.json() as { ok: boolean; dbPath: string };
  assert.equal(body.ok, true);
  assert.equal(body.dbPath, dbPath);

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

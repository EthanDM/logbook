import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCollectorServer } from "../src/server/collector-server.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
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


import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LogbookDatabase,
  startCollector,
} from "@logbook/collector";
import {
  __getActiveLoggerForTests,
  init,
  log,
  shutdownLogger,
} from "../src/logger.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve ephemeral port."));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await sleep(intervalMs);
  }
}

test("SDK logs info events to collector", async () => {
  const root = createTempDir("logbook-sdk-info-");
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const server = await startCollector({
    host: "127.0.0.1",
    port,
    dbPath,
    flushIntervalMs: 10,
    flushQueueThreshold: 1,
    retentionIntervalMs: 60_000,
  });
  const db = new LogbookDatabase({ dbPath });

  try {
    init({
      endpoint: `http://127.0.0.1:${port}/ingest`,
      app: "sdk-test",
      batchIntervalMs: 10,
    });

    log.info("demo.hello", { x: 1 });
    await log.flush();

    await waitFor(() => {
      const rows = db.queryEvents({ name: "demo.hello", limit: 10, order: "asc" });
      return rows.length >= 1;
    });

    const rows = db.queryEvents({ name: "demo.hello", limit: 10, order: "asc" });
    const payload = rows[0]?.payloadJson ? JSON.parse(rows[0].payloadJson) : null;
    assert.equal(payload?.app, "sdk-test");
    assert.equal(payload?.x, 1);
  } finally {
    await shutdownLogger();
    await server.close();
    db.close();
    cleanupDir(root);
  }
});

test("SDK applies context and flow IDs", async () => {
  const root = createTempDir("logbook-sdk-flow-");
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const server = await startCollector({
    host: "127.0.0.1",
    port,
    dbPath,
    flushIntervalMs: 10,
    flushQueueThreshold: 1,
    retentionIntervalMs: 60_000,
  });
  const db = new LogbookDatabase({ dbPath });

  try {
    init({
      endpoint: `http://127.0.0.1:${port}/ingest`,
      app: "sdk-test",
      batchIntervalMs: 10,
    });

    log.setContext({ screen: "Feed", deviceId: "iphone-15" });
    await log.withFlow("flow_refresh", async () => {
      log.info("feed.start");
      await sleep(5);
      log.info("feed.end");
    });
    await log.flush();

    await waitFor(() => {
      const rows = db.queryEvents({ flowId: "flow_refresh", limit: 10, order: "asc" });
      return rows.length === 2;
    });

    const rows = db.queryEvents({
      flowId: "flow_refresh",
      limit: 10,
      order: "asc",
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.screen, "Feed");
    assert.equal(rows[0]?.deviceId, "iphone-15");
    assert.equal(rows[1]?.flowId, "flow_refresh");
  } finally {
    await shutdownLogger();
    await server.close();
    db.close();
    cleanupDir(root);
  }
});

test("SDK can capture unhandled errors when enabled", async () => {
  const root = createTempDir("logbook-sdk-errors-");
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const server = await startCollector({
    host: "127.0.0.1",
    port,
    dbPath,
    flushIntervalMs: 10,
    flushQueueThreshold: 1,
    retentionIntervalMs: 60_000,
  });
  const db = new LogbookDatabase({ dbPath });

  try {
    init({
      endpoint: `http://127.0.0.1:${port}/ingest`,
      app: "sdk-test",
      batchIntervalMs: 10,
      captureUnhandledErrors: true,
    });

    const active = __getActiveLoggerForTests() as
      | {
        processUnhandledRejectionHandler?: (reason: unknown) => void;
        processUncaughtExceptionHandler?: (error: unknown) => void;
      }
      | null;
    assert.ok(active?.processUnhandledRejectionHandler);
    assert.ok(active?.processUncaughtExceptionHandler);

    active.processUnhandledRejectionHandler?.(new Error("reject boom"));
    active.processUncaughtExceptionHandler?.(new Error("uncaught boom"));
    await log.flush();

    await waitFor(() => {
      const rejection = db.queryEvents({
        name: "js.unhandled_rejection",
        limit: 10,
      });
      const uncaught = db.queryEvents({
        name: "js.unhandled_error",
        limit: 10,
      });
      return rejection.length >= 1 && uncaught.length >= 1;
    });

    const rejection = db.queryEvents({
      name: "js.unhandled_rejection",
      limit: 10,
    });
    const uncaught = db.queryEvents({
      name: "js.unhandled_error",
      limit: 10,
    });
    assert.ok(rejection.length >= 1);
    assert.ok(uncaught.length >= 1);
  } finally {
    await shutdownLogger();
    await server.close();
    db.close();
    cleanupDir(root);
  }
});

test("SDK exposes global logger alias when enabled", async () => {
  const root = createTempDir("logbook-sdk-global-");
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const server = await startCollector({
    host: "127.0.0.1",
    port,
    dbPath,
    flushIntervalMs: 10,
    flushQueueThreshold: 1,
    retentionIntervalMs: 60_000,
  });

  try {
    init({
      endpoint: `http://127.0.0.1:${port}/ingest`,
      app: "sdk-test",
      devGlobal: true,
      globalName: "logbookDevLog",
    });

    const globalLog = (globalThis as Record<string, unknown>).logbookDevLog as
      | { info?: (name: string, payload?: unknown) => void }
      | undefined;
    assert.ok(globalLog);
    assert.equal(typeof globalLog?.info, "function");
  } finally {
    await shutdownLogger();
    await server.close();
    cleanupDir(root);
  }
});

import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { startCollector } from "../src/server/collector-server.js";

interface BenchmarkHealth {
  storage: { totalEvents: number };
  stats: { droppedEvents: number; flushFailures: number };
}

const DEFAULT_EVENTS = 20_000;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_WAIT_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const totalEvents = parsePositiveInt(process.env.LOGBOOK_BENCH_EVENTS, DEFAULT_EVENTS);
  const batchSize = parsePositiveInt(process.env.LOGBOOK_BENCH_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const concurrency = parsePositiveInt(
    process.env.LOGBOOK_BENCH_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  );
  const waitTimeoutMs = parsePositiveInt(
    process.env.LOGBOOK_BENCH_WAIT_TIMEOUT_MS,
    DEFAULT_WAIT_TIMEOUT_MS,
  );

  const root = mkdtempSync(join(tmpdir(), "logbook-bench-"));
  const dbPath = join(root, "logs.db");
  const port = await getFreePort();
  const maxQueueSize = Math.max(50_000, totalEvents * 2);

  const server = await startCollector({
    host: "127.0.0.1",
    port,
    dbPath,
    flushIntervalMs: 10,
    flushBatchSize: batchSize,
    flushQueueThreshold: batchSize,
    maxQueueSize,
    retentionIntervalMs: 60_000,
  });

  try {
    const totalBatches = Math.ceil(totalEvents / batchSize);
    let nextBatchIndex = 0;
    let acceptedEvents = 0;
    const ingestStart = performance.now();

    const workers = Array.from({ length: Math.max(1, concurrency) }, () => {
      return (async () => {
        while (true) {
          const batchIndex = nextBatchIndex;
          nextBatchIndex += 1;
          if (batchIndex >= totalBatches) {
            return;
          }

          const batch = createBatch(batchIndex, batchSize, totalEvents);
          const response = await fetch(`http://127.0.0.1:${port}/ingest`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(batch),
          });

          if (!response.ok) {
            const body = await response.text();
            throw new Error(`Ingest failed (${response.status}): ${body}`);
          }

          const json = (await response.json()) as { accepted: number };
          acceptedEvents += json.accepted;
        }
      })();
    });

    await Promise.all(workers);
    const ingestDurationMs = performance.now() - ingestStart;

    const postIngestHealth = await fetchHealth(port);
    const expectedPersisted = acceptedEvents - postIngestHealth.stats.droppedEvents;
    const persistWaitStart = performance.now();

    await waitForPersistedEvents(port, expectedPersisted, waitTimeoutMs);
    const persistedAtMs = performance.now();
    const persistWaitDurationMs = persistedAtMs - persistWaitStart;
    const endToEndDurationMs = persistedAtMs - ingestStart;
    const finalHealth = await fetchHealth(port);

    const enqueueThroughput = ratePerSecond(acceptedEvents, ingestDurationMs);
    const endToEndThroughput = ratePerSecond(expectedPersisted, endToEndDurationMs);

    process.stdout.write("Logbook collector ingest benchmark\n");
    process.stdout.write(`events_total=${totalEvents}\n`);
    process.stdout.write(`batch_size=${batchSize}\n`);
    process.stdout.write(`concurrency=${concurrency}\n`);
    process.stdout.write(`accepted_events=${acceptedEvents}\n`);
    process.stdout.write(`dropped_events=${finalHealth.stats.droppedEvents}\n`);
    process.stdout.write(`flush_failures=${finalHealth.stats.flushFailures}\n`);
    process.stdout.write(`enqueue_duration_ms=${ingestDurationMs.toFixed(2)}\n`);
    process.stdout.write(`enqueue_throughput_eps=${enqueueThroughput.toFixed(2)}\n`);
    process.stdout.write(`persist_wait_duration_ms=${persistWaitDurationMs.toFixed(2)}\n`);
    process.stdout.write(`end_to_end_duration_ms=${endToEndDurationMs.toFixed(2)}\n`);
    process.stdout.write(`end_to_end_throughput_eps=${endToEndThroughput.toFixed(2)}\n`);
    process.stdout.write(`persisted_events=${finalHealth.storage.totalEvents}\n`);
    process.stdout.write(`db_path=${dbPath}\n`);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function createBatch(
  batchIndex: number,
  batchSize: number,
  totalEvents: number,
): Array<{ ts: number; level: "info"; name: string; payload: { index: number } }> {
  const startIndex = batchIndex * batchSize;
  const endIndex = Math.min(totalEvents, startIndex + batchSize);
  const baseTs = Date.now();
  const events: Array<{ ts: number; level: "info"; name: string; payload: { index: number } }> = [];

  for (let index = startIndex; index < endIndex; index += 1) {
    events.push({
      ts: baseTs + index,
      level: "info",
      name: "bench.ingest",
      payload: { index },
    });
  }

  return events;
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to resolve ephemeral port."));
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
    server.on("error", reject);
  });
}

async function fetchHealth(port: number): Promise<BenchmarkHealth> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }

  return (await response.json()) as BenchmarkHealth;
}

async function waitForPersistedEvents(
  port: number,
  expectedPersisted: number,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (true) {
    const health = await fetchHealth(port);
    if (health.storage.totalEvents >= expectedPersisted) {
      return;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for persistence. expected=${expectedPersisted}, actual=${health.storage.totalEvents}`,
      );
    }

    await sleep(25);
  }
}

function ratePerSecond(events: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  return (events / durationMs) * 1000;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

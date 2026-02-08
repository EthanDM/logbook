import { spawn } from "node:child_process";

const DEFAULT_MIN_E2E_EPS = 1500;

async function main() {
  const minThroughput = parsePositiveInt(
    process.env.LOGBOOK_BENCH_MIN_E2E_EPS,
    DEFAULT_MIN_E2E_EPS,
  );

  const env = {
    ...process.env,
    LOGBOOK_BENCH_EVENTS: process.env.LOGBOOK_BENCH_EVENTS ?? "5000",
    LOGBOOK_BENCH_BATCH_SIZE: process.env.LOGBOOK_BENCH_BATCH_SIZE ?? "250",
    LOGBOOK_BENCH_CONCURRENCY: process.env.LOGBOOK_BENCH_CONCURRENCY ?? "4",
    LOGBOOK_BENCH_WAIT_TIMEOUT_MS: process.env.LOGBOOK_BENCH_WAIT_TIMEOUT_MS ?? "30000",
  };

  const { code, stdout, stderr } = await runCommand(
    "pnpm",
    ["-C", "packages/collector", "bench:ingest"],
    env,
  );

  process.stdout.write(stdout);
  if (stderr.trim().length > 0) {
    process.stderr.write(stderr);
  }

  if (code !== 0) {
    throw new Error(`Collector benchmark command failed with exit code ${code ?? "null"}.`);
  }

  const metrics = parseMetrics(stdout);
  const eventsTotal = requireMetric(metrics, "events_total");
  const droppedEvents = requireMetric(metrics, "dropped_events");
  const flushFailures = requireMetric(metrics, "flush_failures");
  const persistedEvents = requireMetric(metrics, "persisted_events");
  const endToEndEps = requireMetric(metrics, "end_to_end_throughput_eps");

  if (droppedEvents !== 0) {
    throw new Error(`Benchmark gate failed: dropped_events=${droppedEvents} (expected 0).`);
  }
  if (flushFailures !== 0) {
    throw new Error(`Benchmark gate failed: flush_failures=${flushFailures} (expected 0).`);
  }
  if (persistedEvents < eventsTotal) {
    throw new Error(
      `Benchmark gate failed: persisted_events=${persistedEvents} < events_total=${eventsTotal}.`,
    );
  }
  if (endToEndEps < minThroughput) {
    throw new Error(
      `Benchmark gate failed: end_to_end_throughput_eps=${endToEndEps.toFixed(2)} < ${minThroughput}.`,
    );
  }

  process.stdout.write(
    `Benchmark gate passed: end_to_end_throughput_eps=${endToEndEps.toFixed(2)}\n`,
  );
}

function parsePositiveInt(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function runCommand(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function parseMetrics(stdout) {
  const metrics = new Map();
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([a-z_]+)=([0-9.]+)$/);
    if (!match) {
      continue;
    }
    metrics.set(match[1], Number.parseFloat(match[2]));
  }
  return metrics;
}

function requireMetric(metrics, key) {
  const value = metrics.get(key);
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Benchmark gate failed: missing metric \`${key}\`.`);
  }
  return value;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

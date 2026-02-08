import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "node:path";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8787/ingest";
const DEFAULT_DELAY_MS = 200;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_FIXTURE = join(
  process.cwd(),
  "scripts",
  "fixtures",
  "web-demo.ndjson",
);

const args = parseArgs(process.argv.slice(2));
const endpoint = args.endpoint ?? DEFAULT_ENDPOINT;
const delayMs = parseNonNegativeInt(args["delay-ms"], DEFAULT_DELAY_MS);
const batchSize = parsePositiveInt(args["batch-size"], DEFAULT_BATCH_SIZE);
const fixturePath = args.fixture ?? DEFAULT_FIXTURE;
const loop = args.loop === "true";
const rebaseTs = args["rebase-ts"] !== "false";

const events = readFixture(fixturePath);
if (events.length === 0) {
  throw new Error(`Fixture has no events: ${fixturePath}`);
}

let run = 0;
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

process.stdout.write(
  `Replay started endpoint=${endpoint} fixture=${fixturePath} events=${events.length} loop=${loop}\n`,
);

while (!stopping) {
  run += 1;
  const baseTs = Date.now();

  for (let offset = 0; offset < events.length; offset += batchSize) {
    if (stopping) {
      break;
    }

    const batch = events
      .slice(offset, offset + batchSize)
      .map((event, index) => {
        if (!rebaseTs) {
          return event;
        }
        return {
          ...event,
          ts: baseTs + offset + index,
        };
      });

    const ok = await postEvents(endpoint, batch);
    if (!ok) {
      process.stdout.write(
        `Replay batch failed run=${run} batchStart=${offset} size=${batch.length}\n`,
      );
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  process.stdout.write(
    `Replay run complete run=${run} sent=${events.length}\n`,
  );
  if (!loop) {
    break;
  }
}

process.stdout.write(`Replay stopped runs=${run}\n`);

function readFixture(path) {
  const content = readFileSync(path, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines.map((line, index) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON in fixture line ${index + 1}.`);
    }

    if (!parsed.ts) {
      parsed.ts = Date.now() + index;
    }
    return parsed;
  });
}

async function postEvents(url, eventsBatch) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(eventsBatch),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      parsed[key] = value;
      index += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
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

function parseNonNegativeInt(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

import { setTimeout as sleep } from "node:timers/promises";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8787/ingest";
const DEFAULT_INTERVAL_MS = 400;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_DEVICES = 4;
const DEFAULT_SEED = 1337;

const args = parseArgs(process.argv.slice(2));
const endpoint = args.endpoint ?? DEFAULT_ENDPOINT;
const intervalMs = parsePositiveInt(args["interval-ms"], DEFAULT_INTERVAL_MS);
const batchSize = parsePositiveInt(args["batch-size"], DEFAULT_BATCH_SIZE);
const deviceCount = parsePositiveInt(args.devices, DEFAULT_DEVICES);
const seed = parsePositiveInt(args.seed, DEFAULT_SEED);
const maxEvents = args["max-events"]
  ? parsePositiveInt(args["max-events"], 0)
  : 0;

const random = createRng(seed);
const devices = Array.from({ length: deviceCount }, (_, index) => ({
  id: `device-${index + 1}`,
  sessionId: `session-${index + 1}-${Date.now()}`,
  flowSeq: 0,
  activeFlowId: null,
  activeFlowStep: 0,
}));

const flowSteps = [
  "ui.tap",
  "api.request",
  "api.response",
  "state.commit",
  "screen.render",
];

let stopping = false;
let sent = 0;
let accepted = 0;
let failedBatches = 0;
let dropped = 0;
let tickInFlight = false;
const startedAtMs = Date.now();
let nextStatsAtMs = Date.now() + 2000;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

process.stdout.write(
  `Demo stream started endpoint=${endpoint} batchSize=${batchSize} intervalMs=${intervalMs} seed=${seed}\n`,
);

while (!stopping && (maxEvents === 0 || sent < maxEvents)) {
  if (!tickInFlight) {
    tickInFlight = true;
    try {
      const remaining =
        maxEvents > 0 ? Math.max(0, maxEvents - sent) : batchSize;
      if (maxEvents > 0 && remaining === 0) {
        break;
      }
      const size = Math.min(batchSize, remaining);
      const events = Array.from({ length: size }, () => buildEvent());
      sent += events.length;
      const response = await postEvents(endpoint, events);

      if (response.ok) {
        accepted += response.accepted;
        dropped = response.dropped;
      } else {
        failedBatches += 1;
      }
    } catch {
      failedBatches += 1;
    } finally {
      tickInFlight = false;
    }
  }

  if (Date.now() >= nextStatsAtMs) {
    nextStatsAtMs = Date.now() + 2000;
    const elapsedSec = Math.max(
      1,
      Math.floor((Date.now() - startedAtMs) / 1000),
    );
    process.stdout.write(
      `stream sent=${sent} accepted=${accepted} dropped=${dropped} failedBatches=${failedBatches} eps=${(sent / elapsedSec).toFixed(1)}\n`,
    );
  }

  await sleep(intervalMs);
}

process.stdout.write(
  `Demo stream stopped sent=${sent} accepted=${accepted} dropped=${dropped} failedBatches=${failedBatches}\n`,
);

function buildEvent() {
  const device = devices[Math.floor(random() * devices.length)];
  const shouldStartFlow = device.activeFlowId === null || random() < 0.2;
  if (shouldStartFlow) {
    device.flowSeq += 1;
    device.activeFlowId = `${device.id}-flow-${String(device.flowSeq).padStart(4, "0")}`;
    device.activeFlowStep = 0;
  }

  const step = flowSteps[device.activeFlowStep] ?? "screen.render";
  const name = `demo.${step}`;

  let level = "info";
  const isError = step === "api.response" && random() < 0.1;
  if (isError) {
    level = "error";
  } else if (step === "api.response" && random() < 0.2) {
    level = "warn";
  }

  const screen = pick(random, ["Home", "Feed", "Settings", "Profile"]);
  const latencyMs = Math.floor(20 + random() * 400);
  const payload = {
    app: "web-demo",
    step,
    ok: !isError,
    latencyMs,
    batteryPct: Math.floor(30 + random() * 70),
    network: pick(random, ["wifi", "5g", "lte"]),
    tag: pick(random, ["baseline", "stress", "smoke"]),
  };

  const event = {
    ts: Date.now(),
    level,
    name,
    deviceId: device.id,
    sessionId: device.sessionId,
    flowId: device.activeFlowId,
    screen,
    payload,
    ...(isError
      ? {
          msg: "Synthetic API failure",
        }
      : {}),
  };

  device.activeFlowStep += 1;
  if (device.activeFlowStep >= flowSteps.length || random() < 0.08) {
    device.activeFlowId = null;
    device.activeFlowStep = 0;
  }

  return event;
}

async function postEvents(url, events) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(events),
  });

  if (!response.ok) {
    return { ok: false, accepted: 0, dropped: 0 };
  }

  const body = await response.json();
  return {
    ok: true,
    accepted: typeof body.accepted === "number" ? body.accepted : 0,
    dropped: typeof body.dropped === "number" ? body.dropped : 0,
  };
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

function createRng(seedValue) {
  let state = seedValue >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick(randomFn, items) {
  return items[Math.floor(randomFn() * items.length)];
}

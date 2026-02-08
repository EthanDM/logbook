import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOG_LEVELS,
  isLogLevel,
  type LogEvent,
} from "../src/events.js";

test("LOG_LEVELS stays ordered and complete", () => {
  assert.deepEqual(LOG_LEVELS, ["debug", "info", "warn", "error"]);
});

test("isLogLevel validates supported levels", () => {
  assert.equal(isLogLevel("debug"), true);
  assert.equal(isLogLevel("info"), true);
  assert.equal(isLogLevel("warn"), true);
  assert.equal(isLogLevel("error"), true);

  assert.equal(isLogLevel("fatal"), false);
  assert.equal(isLogLevel(""), false);
  assert.equal(isLogLevel(123), false);
  assert.equal(isLogLevel(null), false);
});

test("LogEvent supports required and optional fields", () => {
  const event: LogEvent = {
    ts: 1_738_890_000_000,
    level: "info",
    name: "demo.hello",
    deviceId: "iphone-15-pro",
    sessionId: "session-1",
    flowId: "flow-1",
    screen: "Feed",
    msg: "hello world",
    payload: {
      x: 1,
    },
  };

  assert.equal(event.name, "demo.hello");
  assert.equal(event.level, "info");
  assert.equal(event.deviceId, "iphone-15-pro");
  assert.deepEqual(event.payload, { x: 1 });
});

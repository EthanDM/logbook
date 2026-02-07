import type { LogEvent, LogLevel } from "@logbook/core";

const DEFAULT_BATCH_INTERVAL_MS = 250;
const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_QUEUE_SIZE = 5_000;

type LoggerFn<T = void> = (...args: unknown[]) => T;

export interface LoggerContext {
  deviceId?: string;
  sessionId?: string;
  flowId?: string;
  screen?: string;
}

export interface InitConfig {
  endpoint: string;
  app: string;
  batchIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
  context?: LoggerContext;
  devGlobal?: boolean;
  globalName?: string;
  captureUnhandledErrors?: boolean;
}

export interface LogbookLoggerApi {
  debug: (name: string, payload?: unknown) => void;
  info: (name: string, payload?: unknown) => void;
  warn: (name: string, payload?: unknown) => void;
  error: (name: string, payload?: unknown, error?: unknown) => void;
  setContext: (context: Partial<LoggerContext>) => void;
  withFlow: <T>(flowId: string, fn: () => T) => T;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

export class LogbookLogger implements LogbookLoggerApi {
  private readonly endpoint: string;
  private readonly app: string;
  private readonly batchIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxQueueSize: number;
  private readonly queue: LogEvent[] = [];
  private readonly flowStack: string[] = [];
  private context: LoggerContext;
  private timer: NodeJS.Timeout | null = null;
  private flushInProgress = false;
  private started = false;
  private stopped = false;

  private processUnhandledRejectionHandler?: LoggerFn;
  private processUncaughtExceptionHandler?: LoggerFn;
  private onBeforeExitHandler?: LoggerFn;
  private browserVisibilityHandler?: LoggerFn;
  private browserUnloadHandler?: LoggerFn;
  private browserUnhandledErrorHandler?: LoggerFn;
  private browserUnhandledRejectionHandler?: LoggerFn;

  constructor(config: InitConfig) {
    if (!config.endpoint) {
      throw new Error("`endpoint` is required.");
    }
    if (!config.app) {
      throw new Error("`app` is required.");
    }

    this.endpoint = config.endpoint;
    this.app = config.app;
    this.batchIntervalMs = normalizePositiveInt(
      config.batchIntervalMs,
      DEFAULT_BATCH_INTERVAL_MS,
    );
    this.batchSize = normalizePositiveInt(config.batchSize, DEFAULT_BATCH_SIZE);
    this.maxQueueSize = normalizePositiveInt(
      config.maxQueueSize,
      DEFAULT_MAX_QUEUE_SIZE,
    );
    this.context = { ...(config.context ?? {}) };

    this.start();

    if (config.captureUnhandledErrors) {
      this.enableUnhandledCapture();
    }
    this.enableBestEffortFlushHooks();
  }

  debug(name: string, payload?: unknown): void {
    this.log("debug", name, payload);
  }

  info(name: string, payload?: unknown): void {
    this.log("info", name, payload);
  }

  warn(name: string, payload?: unknown): void {
    this.log("warn", name, payload);
  }

  error(name: string, payload?: unknown, error?: unknown): void {
    const mergedPayload =
      error === undefined ? payload : mergeErrorPayload(payload, error);
    this.log("error", name, mergedPayload);
  }

  setContext(context: Partial<LoggerContext>): void {
    this.context = {
      ...this.context,
      ...stripUndefined(context),
    };
  }

  withFlow<T>(flowId: string, fn: () => T): T {
    if (!flowId) {
      return fn();
    }

    this.flowStack.push(flowId);
    try {
      const result = fn();
      if (isPromiseLike(result)) {
        return result.finally(() => {
          this.popFlow(flowId);
        }) as T;
      }
      this.popFlow(flowId);
      return result;
    } catch (error) {
      this.popFlow(flowId);
      throw error;
    }
  }

  async flush(force = false): Promise<void> {
    if (
      this.flushInProgress ||
      this.queue.length === 0 ||
      (this.stopped && !force)
    ) {
      return;
    }

    this.flushInProgress = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, this.batchSize);
        const accepted = await this.sendBatch(batch);
        if (!accepted) {
          break;
        }
        this.queue.splice(0, batch.length);
      }
    } finally {
      this.flushInProgress = false;
    }
  }

  async shutdown(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.stopped = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.disableUnhandledCapture();
    this.disableBestEffortFlushHooks();
    await this.flush(true);
  }

  private start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.batchIntervalMs);

    if (typeof (this.timer as NodeJS.Timeout).unref === "function") {
      (this.timer as NodeJS.Timeout).unref();
    }
  }

  private log(level: LogLevel, name: string, payload?: unknown): void {
    if (!name || this.stopped) {
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }

    const flowId = this.currentFlowId();
    const event: LogEvent = {
      ts: Date.now(),
      level,
      name,
      payload: attachAppMetadata(payload, this.app),
      ...this.context,
      ...(flowId ? { flowId } : {}),
    };

    this.queue.push(event);
  }

  private currentFlowId(): string | undefined {
    const scopedFlow = this.flowStack.at(-1);
    return scopedFlow ?? this.context.flowId;
  }

  private popFlow(flowId: string): void {
    if (this.flowStack.length === 0) {
      return;
    }

    const index = this.flowStack.lastIndexOf(flowId);
    if (index >= 0) {
      this.flowStack.splice(index, 1);
    } else {
      this.flowStack.pop();
    }
  }

  private async sendBatch(batch: LogEvent[]): Promise<boolean> {
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
        keepalive: true,
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  private enableUnhandledCapture(): void {
    if (typeof process !== "undefined" && typeof process.on === "function") {
      this.processUnhandledRejectionHandler = (reason: unknown) => {
        this.error("js.unhandled_rejection", undefined, reason);
      };
      this.processUncaughtExceptionHandler = (error: unknown) => {
        this.error("js.unhandled_error", undefined, error);
      };
      process.on(
        "unhandledRejection",
        this.processUnhandledRejectionHandler as (
          reason: unknown,
          promise: Promise<unknown>,
        ) => void,
      );
      process.on(
        "uncaughtExceptionMonitor",
        this.processUncaughtExceptionHandler as (
          error: Error,
          origin: NodeJS.UncaughtExceptionOrigin,
        ) => void,
      );
    }

    if (
      typeof globalThis !== "undefined" &&
      "addEventListener" in globalThis &&
      typeof globalThis.addEventListener === "function"
    ) {
      this.browserUnhandledErrorHandler = (event: unknown) => {
        const errorLike = event as {
          message?: unknown;
          filename?: unknown;
          lineno?: unknown;
          colno?: unknown;
        };
        this.error("js.unhandled_error", {
          message: toStringOrUndefined(errorLike.message),
          filename: toStringOrUndefined(errorLike.filename),
          line: toNumberOrUndefined(errorLike.lineno),
          column: toNumberOrUndefined(errorLike.colno),
        });
      };
      this.browserUnhandledRejectionHandler = (event: unknown) => {
        const rejectionLike = event as { reason?: unknown };
        this.error("js.unhandled_rejection", undefined, rejectionLike.reason);
      };
      globalThis.addEventListener("error", this.browserUnhandledErrorHandler);
      globalThis.addEventListener(
        "unhandledrejection",
        this.browserUnhandledRejectionHandler,
      );
    }
  }

  private disableUnhandledCapture(): void {
    if (
      typeof process !== "undefined" &&
      typeof process.off === "function" &&
      this.processUnhandledRejectionHandler &&
      this.processUncaughtExceptionHandler
    ) {
      process.off(
        "unhandledRejection",
        this.processUnhandledRejectionHandler as (
          reason: unknown,
          promise: Promise<unknown>,
        ) => void,
      );
      process.off(
        "uncaughtExceptionMonitor",
        this.processUncaughtExceptionHandler as (
          error: Error,
          origin: NodeJS.UncaughtExceptionOrigin,
        ) => void,
      );
    }

    if (
      typeof globalThis !== "undefined" &&
      "removeEventListener" in globalThis &&
      typeof globalThis.removeEventListener === "function" &&
      this.browserUnhandledErrorHandler &&
      this.browserUnhandledRejectionHandler
    ) {
      globalThis.removeEventListener("error", this.browserUnhandledErrorHandler);
      globalThis.removeEventListener(
        "unhandledrejection",
        this.browserUnhandledRejectionHandler,
      );
    }
  }

  private enableBestEffortFlushHooks(): void {
    if (typeof process !== "undefined" && typeof process.on === "function") {
      this.onBeforeExitHandler = () => {
        void this.flush();
      };
      process.on("beforeExit", this.onBeforeExitHandler as () => void);
    }

    if (
      typeof globalThis !== "undefined" &&
      "addEventListener" in globalThis &&
      typeof globalThis.addEventListener === "function"
    ) {
      this.browserVisibilityHandler = () => {
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          void this.flush();
        }
      };
      this.browserUnloadHandler = () => {
        void this.flush();
      };

      globalThis.addEventListener("visibilitychange", this.browserVisibilityHandler);
      globalThis.addEventListener("pagehide", this.browserUnloadHandler);
      globalThis.addEventListener("beforeunload", this.browserUnloadHandler);
    }
  }

  private disableBestEffortFlushHooks(): void {
    if (
      typeof process !== "undefined" &&
      typeof process.off === "function" &&
      this.onBeforeExitHandler
    ) {
      process.off("beforeExit", this.onBeforeExitHandler as () => void);
    }

    if (
      typeof globalThis !== "undefined" &&
      "removeEventListener" in globalThis &&
      typeof globalThis.removeEventListener === "function"
    ) {
      if (this.browserVisibilityHandler) {
        globalThis.removeEventListener(
          "visibilitychange",
          this.browserVisibilityHandler,
        );
      }
      if (this.browserUnloadHandler) {
        globalThis.removeEventListener("pagehide", this.browserUnloadHandler);
        globalThis.removeEventListener("beforeunload", this.browserUnloadHandler);
      }
    }
  }
}

export interface InitResult {
  log: LogbookLoggerApi;
}

let activeLogger: LogbookLogger | null = null;

export const log: LogbookLoggerApi = {
  debug(name, payload) {
    activeLogger?.debug(name, payload);
  },
  info(name, payload) {
    activeLogger?.info(name, payload);
  },
  warn(name, payload) {
    activeLogger?.warn(name, payload);
  },
  error(name, payload, error) {
    activeLogger?.error(name, payload, error);
  },
  setContext(context) {
    activeLogger?.setContext(context);
  },
  withFlow(flowId, fn) {
    if (!activeLogger) {
      return fn();
    }
    return activeLogger.withFlow(flowId, fn);
  },
  flush() {
    return activeLogger?.flush() ?? Promise.resolve();
  },
  shutdown() {
    return activeLogger?.shutdown() ?? Promise.resolve();
  },
};

export function init(config: InitConfig): InitResult {
  if (activeLogger) {
    void activeLogger.shutdown();
  }

  activeLogger = new LogbookLogger(config);

  if (config.devGlobal) {
    const globalName = config.globalName || "log";
    setGlobal(globalName, log);
  }

  return { log };
}

export async function shutdownLogger(): Promise<void> {
  if (!activeLogger) {
    return;
  }
  await activeLogger.shutdown();
  activeLogger = null;
}

export function __getActiveLoggerForTests(): LogbookLogger | null {
  return activeLogger;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

function mergeErrorPayload(payload: unknown, error: unknown): unknown {
  const errorPayload = serializeError(error);
  if (payload === undefined) {
    return errorPayload;
  }

  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return {
      ...(payload as Record<string, unknown>),
      error: errorPayload,
    };
  }

  return {
    value: payload,
    error: errorPayload,
  };
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const entries = Object.entries(obj).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as T;
}

function attachAppMetadata(payload: unknown, app: string): unknown {
  if (payload === undefined) {
    return { app };
  }
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return { app, ...(payload as Record<string, unknown>) };
  }
  return {
    app,
    value: payload,
  };
}

function isPromiseLike<T = unknown>(
  value: unknown,
): value is Promise<T> & { finally: (onFinally: () => void) => Promise<T> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function setGlobal(name: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[name] = value;
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

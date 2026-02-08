import { useMemo } from "react";
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { parseNonNegativeInt, parsePositiveInt } from "./filters";

type LogLevel = "debug" | "info" | "warn" | "error";

interface EventRow {
  id: number;
  ts: number;
  level: LogLevel;
  name: string;
  deviceId: string | null;
  sessionId: string | null;
  flowId: string | null;
  screen: string | null;
  msg: string | null;
  payloadJson: string | null;
}

interface HealthResponse {
  ok: boolean;
  dbPath: string;
  queue: { length: number; maxSize: number };
  stats: {
    droppedEvents: number;
    flushFailures: number;
    retentionFailures: number;
  };
  storage: { totalEvents: number };
}

interface EventsResponse {
  ok: boolean;
  count: number;
  items: EventRow[];
}

interface AroundResponse {
  ok: boolean;
  count: number;
  event: EventRow;
  items: EventRow[];
  windowMs: number;
}

interface SummaryResponse {
  ok: boolean;
  summary: {
    totals: {
      totalEvents: number;
      uniqueDevices: number;
      timeRange: string;
    };
    topEvents: Array<{ name: string; count: number }>;
    errors: Array<{ name: string; count: number; lastTs: number }>;
    recentFlows: Array<{ flowId: string; count: number; lastTs: number }>;
  };
}

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Logbook</p>
          <h1>Local Event Dashboard</h1>
        </div>
        <nav className="nav-links">
          <Link to="/">Events</Link>
          <a href="/api/health" target="_blank" rel="noreferrer">
            Raw Health
          </a>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<EventsPage />} />
        <Route path="/event/:eventId" element={<EventDetailPage />} />
        <Route path="/flow/:flowId" element={<FlowPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function EventsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const level = searchParams.get("level") ?? "";
  const name = searchParams.get("name") ?? "";
  const flowId = searchParams.get("flowId") ?? "";
  const deviceId = searchParams.get("deviceId") ?? "";
  const since = searchParams.get("since") ?? "";
  const until = searchParams.get("until") ?? "";
  const limit = parsePositiveInt(searchParams.get("limit"), 200);
  const offset = parseNonNegativeInt(searchParams.get("offset"), 0);

  const eventsParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("order", "desc");
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (level) params.set("level", level);
    if (name) params.set("name", name);
    if (flowId) params.set("flowId", flowId);
    if (deviceId) params.set("deviceId", deviceId);
    if (since) params.set("since", since);
    if (until) params.set("until", until);
    return params.toString();
  }, [deviceId, flowId, level, limit, name, offset, since, until]);

  const events = useQuery({
    queryKey: ["events", eventsParams],
    queryFn: () => fetchJson<EventsResponse>(`/api/events?${eventsParams}`),
    refetchInterval: 1_000,
  });

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJson<HealthResponse>("/api/health"),
    refetchInterval: 2_000,
  });

  const summary = useQuery({
    queryKey: ["summary", since || "15m"],
    queryFn: () =>
      fetchJson<SummaryResponse>(`/api/summary?since=${encodeURIComponent(since || "15m")}`),
    refetchInterval: 5_000,
  });

  const visibleCount = events.data?.items.length ?? 0;
  const pageStart = visibleCount > 0 ? offset + 1 : 0;
  const pageEnd = offset + visibleCount;
  const hasPreviousPage = offset > 0;
  const hasNextPage = visibleCount === limit;

  return (
    <div className="grid">
      <section className="panel">
        <h2>Events</h2>
        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const next = new URLSearchParams();
            const nextLevel = String(formData.get("level") ?? "");
            const nextName = String(formData.get("name") ?? "");
            const nextFlow = String(formData.get("flowId") ?? "");
            const nextDevice = String(formData.get("deviceId") ?? "");
            const nextSince = String(formData.get("since") ?? "");
            const nextUntil = String(formData.get("until") ?? "");
            const nextLimit = parsePositiveInt(formData.get("limit"), 200);

            if (nextLevel) next.set("level", nextLevel);
            if (nextName) next.set("name", nextName);
            if (nextFlow) next.set("flowId", nextFlow);
            if (nextDevice) next.set("deviceId", nextDevice);
            if (nextSince) next.set("since", nextSince);
            if (nextUntil) next.set("until", nextUntil);
            next.set("limit", String(nextLimit));
            next.set("offset", "0");
            setSearchParams(next);
          }}
        >
          <label>
            Level
            <select name="level" defaultValue={level}>
              <option value="">all</option>
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </label>
          <label>
            Name
            <input name="name" defaultValue={name} placeholder="Substring" />
          </label>
          <label>
            Flow
            <input name="flowId" defaultValue={flowId} placeholder="flow_123" />
          </label>
          <label>
            Device
            <input name="deviceId" defaultValue={deviceId} placeholder="iphone-15" />
          </label>
          <label>
            Since
            <input name="since" defaultValue={since} placeholder="15m or ISO timestamp" />
          </label>
          <label>
            Until
            <input name="until" defaultValue={until} placeholder="now or ISO timestamp" />
          </label>
          <label>
            Limit
            <input name="limit" defaultValue={String(limit)} inputMode="numeric" />
          </label>
          <button type="submit">Apply</button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setSearchParams({
                limit: "200",
                offset: "0",
              });
            }}
          >
            Reset
          </button>
        </form>

        {events.isLoading ? <p>Loading events...</p> : null}
        {events.isError ? <p>Failed to load events.</p> : null}

        <div className="events-toolbar">
          <p className="muted">
            Showing {pageStart}-{pageEnd}
          </p>
          <div className="pager">
            <button
              type="button"
              disabled={!hasPreviousPage}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                const nextOffset = Math.max(0, offset - limit);
                next.set("offset", String(nextOffset));
                setSearchParams(next);
              }}
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!hasNextPage}
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("offset", String(offset + limit));
                setSearchParams(next);
              }}
            >
              Next
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Name</th>
                <th>Flow</th>
                <th>Device</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {events.data?.items.map((row) => (
                <tr key={row.id}>
                  <td>{formatTime(row.ts)}</td>
                  <td>
                    <span className={`level level-${row.level}`}>{row.level}</span>
                  </td>
                  <td>
                    <Link to={`/event/${row.id}`}>{row.name}</Link>
                  </td>
                  <td>
                    {row.flowId ? <Link to={`/flow/${row.flowId}`}>{row.flowId}</Link> : "—"}
                  </td>
                  <td>{row.deviceId ?? "—"}</td>
                  <td>{eventPreview(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="side">
        <section className="panel">
          <h2>Collector Health</h2>
          {health.isSuccess ? (
            <dl className="stats">
              <div>
                <dt>DB</dt>
                <dd>{health.data.dbPath}</dd>
              </div>
              <div>
                <dt>Queue</dt>
                <dd>
                  {health.data.queue.length} / {health.data.queue.maxSize}
                </dd>
              </div>
              <div>
                <dt>Total Events</dt>
                <dd>{health.data.storage.totalEvents}</dd>
              </div>
              <div>
                <dt>Dropped</dt>
                <dd>{health.data.stats.droppedEvents}</dd>
              </div>
              <div>
                <dt>Flush Failures</dt>
                <dd>{health.data.stats.flushFailures}</dd>
              </div>
              <div>
                <dt>Retention Failures</dt>
                <dd>{health.data.stats.retentionFailures}</dd>
              </div>
            </dl>
          ) : (
            <p>Waiting for collector...</p>
          )}
        </section>

        <section className="panel">
          <h2>Summary ({since || "15m"})</h2>
          {summary.isSuccess ? (
            <div className="summary">
              <p>Total events: {summary.data.summary.totals.totalEvents}</p>
              <p>Unique devices: {summary.data.summary.totals.uniqueDevices}</p>
              <p>Range: {summary.data.summary.totals.timeRange}</p>
              <h3>Top Events</h3>
              <ul>
                {summary.data.summary.topEvents.slice(0, 5).map((item) => (
                  <li key={item.name}>
                    {item.name} ({item.count})
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>Loading summary...</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function EventDetailPage() {
  const { eventId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const windowMs = searchParams.get("windowMs") ?? "5000";

  const around = useQuery({
    queryKey: ["around", eventId, windowMs],
    queryFn: () => fetchJson<AroundResponse>(`/api/events/${eventId}/around?windowMs=${windowMs}`),
    enabled: Boolean(eventId),
    refetchInterval: 1_000,
  });

  if (around.isLoading) {
    return <section className="panel">Loading event context...</section>;
  }
  if (around.isError || !around.data) {
    return (
      <section className="panel">
        <p>Event was not found.</p>
        <Link to="/">Back to events</Link>
      </section>
    );
  }

  return (
    <section className="panel">
      <p className="muted">
        <Link to="/">Back to events</Link>
      </p>
      <h2>Event #{around.data.event.id}</h2>
      <p>
        {formatTime(around.data.event.ts)} · {around.data.event.level} · {around.data.event.name}
      </p>
      <pre className="payload">{prettyPayload(around.data.event.payloadJson)}</pre>

      <h3>Context (+/- {around.data.windowMs}ms)</h3>
      <ul className="timeline">
        {around.data.items.map((row) => (
          <li key={row.id} className={row.id === around.data.event.id ? "active" : ""}>
            <span>{formatTime(row.ts)}</span>
            <Link to={`/event/${row.id}`}>{row.name}</Link>
            {row.flowId ? <Link to={`/flow/${row.flowId}`}>{row.flowId}</Link> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function FlowPage() {
  const { flowId = "" } = useParams();

  const flow = useQuery({
    queryKey: ["flow", flowId],
    queryFn: () => fetchJson<EventsResponse>(`/api/flows/${encodeURIComponent(flowId)}?limit=500`),
    enabled: Boolean(flowId),
    refetchInterval: 1_500,
  });

  if (!flowId) {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="panel">
      <p className="muted">
        <Link to="/">Back to events</Link>
      </p>
      <h2>Flow: {flowId}</h2>
      {flow.isLoading ? <p>Loading flow...</p> : null}
      {flow.isError ? <p>Failed to load flow.</p> : null}
      <ol className="timeline numbered">
        {flow.data?.items.map((row) => (
          <li key={row.id}>
            <span>{formatTime(row.ts)}</span>
            <Link to={`/event/${row.id}`}>{row.name}</Link>
            <span>{eventPreview(row)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        errorMessage = body.error;
      }
    } catch {
      // Ignore parsing errors for non-JSON responses.
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function eventPreview(row: EventRow): string {
  if (row.msg) {
    return row.msg;
  }
  if (!row.payloadJson) {
    return "—";
  }
  if (row.payloadJson.length <= 80) {
    return row.payloadJson;
  }
  return `${row.payloadJson.slice(0, 79)}...`;
}

function prettyPayload(payloadJson: string | null): string {
  if (!payloadJson) {
    return "{}";
  }
  try {
    return JSON.stringify(JSON.parse(payloadJson), null, 2);
  } catch {
    return payloadJson;
  }
}

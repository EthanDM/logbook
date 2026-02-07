# Day 1 Objective and Stop Condition

## Objective

Stop feature expansion once this workflow proves clear value over `console.log`:

```sh
logbook dev
curl -XPOST localhost:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"ts":1738890000000,"level":"info","name":"demo.hello","payload":{"x":1}}'
logbook tail
logbook summary --since 5m
```

## Required Outcomes

- [x] Collector starts and accepts ingest.
- [x] Event appears in `tail`.
- [x] Summary includes that event in deterministic output.
- [x] Running this loop feels materially better than raw console logging.

## If Day 1 Passes

- Proceed to Milestone 4 (SDK).

## Validation Notes

- Smoke-tested with temporary DB and local collector:
- `dev` start
- `POST /ingest`
- `tail`
- `summary --since 5m`

## If Day 1 Fails

- Improve collector and CLI ergonomics first.
- Do not start SDK or sink integrations yet.

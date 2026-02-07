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

- [ ] Collector starts and accepts ingest.
- [ ] Event appears in `tail`.
- [ ] Summary includes that event in deterministic output.
- [ ] Running this loop feels materially better than raw console logging.

## If Day 1 Passes

- Proceed to Milestone 4 (SDK).

## If Day 1 Fails

- Improve collector and CLI ergonomics first.
- Do not start SDK or sink integrations yet.


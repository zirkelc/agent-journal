# nebula

nebula is the main product of a small company: a hosted service that takes in events from the customers' apps, keeps them, and lets the customers search them and see dashboards. About 40 business customers, a few of them large. The team is five people: the user (lead), Mara (backend), Tobias (infrastructure), Lena (frontend of the admin console) and Sam (support and docs, joins about day -600).

## Stack

- Ingest workers in Go, behind an AWS load balancer, on ECS with Terraform. The ingest API takes batches of JSON events over HTTP/2.
- A queue between the ingest API and the workers: Redpanda, one topic with priorities, partitioned by event type.
- Postgres 16 for accounts, settings, the audit log and, at first, the events.
- Redis for the query cache, the rate limiter counters and the session store of the admin console.
- OpenSearch for full text search over the events, with a nightly reindex job.
- The search API and the admin console in TypeScript (Fastify, React).
- From day -700 on, ClickHouse for the analytics events (see the timeline).
- Grafana and Prometheus for metrics, PagerDuty for the on-call.

## Timeline (days relative to today, negative is the past)

- -1095 to -900: the first version. The ingest worker, the event schema, the batch importer for CSV and NDJSON files, the deploy pipeline on ECS, the first customers. Many small fixes to the worker under load.
- -900 to -710: the search API v1 on OpenSearch, the rate limiter on Redis, the admin console, the public API docs. The analytics queries run on the events table in Postgres and get slower each month; the dashboards time out for the large customers.
- -710 to -701: one week of benchmarks for a new store for the analytics events. Entries in this week talk about the benchmark setup, loading the real event stream, query sets and the two candidates, ClickHouse and TimescaleDB, but never say which one won or the final numbers. Day -700 has the decision; it is already written.
- -700 to -450: the analytics events move to ClickHouse: the loader, the backfill of old events, the dashboard queries rewritten, the materialized views. After the decision, entries mention ClickHouse as the store that is there, never why it was chosen and never a comparison with another database. Also the audit log and the schema registry (branch schema-registry).
- -450 to -200: search v2 (branch search-v2): a new query parser, per-field boosts, the reindex job. Rate limits per API key (branch rate-limits). The public API docs get examples. The alert rules move to code. Day -200: the retention of the raw analytics events changes; already written.
- -200 to -60: the audit export for compliance (branch audit-export), the document loader with retries for large files (branch loader-retry), batch writes in the ingest worker (branch ingest-batching), cost work on AWS. About days -150 to -130, a migration of the infrastructure to new AWS accounts; a lot of moving of cron jobs and secrets. Nothing breaks at the time.
- -60 to -2: a busy phase with several experiments that fail; they are already written (see the key entries). Other work in this phase: Redis connection and memory problems, cache hit rates, the latency of the search API, the planning of a new shard layout for the search index (by month instead of by customer), the schema registry, alerts, on-call fixes. Day -21 is the day of a large outage of the ingest API (already written); the other sessions that day work on other things and may mention the outage in passing, but not its cause.

## Near misses to include

- Redis appears often: connection pools, memory use, cache hit rates, key naming, a Redis version upgrade, TTLs of some keys. Never the eviction policy.
- The search index and its shards appear often, from about day -100 on, as a plan; the migration itself has not started before day -2.
- Postgres appears often as the main database: slow queries, indexes, vacuum, a minor version upgrade. The upgrade to Postgres 17 is only in a key entry.
- Failed or abandoned smaller attempts happen, as in any project: a library that did not work out, a refactor that was rolled back. Keep them to other topics than the key entries.
- Retries are a normal topic (the loader, the ingest client), but never a "retry wrapper" around a test.

## Branches

ingest-batching, search-v2, audit-export, rate-limits, schema-registry, loader-retry. A session runs in a worktree of the branch only when its work is the topic of that branch and the branch exists in that period (see the timeline). Most sessions run in the main checkout.

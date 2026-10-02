# Google Analytics (GA4)

Read-only GA4 ingest for Udderly. Provider name: `google_analytics`.

This is **not** Google Ads campaign reporting and **not** Google Search Console. Ads link metadata may be stored as configuration evidence. Search Console is a separate future integration.

## Property

- Google Cloud project: `149142180924`
- GA4 account: `accounts/197622407`
- Property: `properties/310874507` (configurable as `GOOGLE_ANALYTICS_PROPERTY_ID`)
- Web stream: `properties/310874507/dataStreams/3445631200`
- Measurement ID: `G-Z0FL7CST28`
- Default URI: `https://udderlyridiculousfarmlife.com`
- Property created: `2022-04-12`
- Earliest useful report date: **2022-04-13**
- Authoritative timezone comes from Admin property evidence (currently America/Toronto)
- Currency comes from Admin evidence (currently CAD)

Farm dates are the GA `date` dimension strings (YYYYMMDD) interpreted as property-timezone calendar dates. They are **not** converted as UTC instants.

## Credentials

Optional. The API starts without them. All four are required to import:

```
GOOGLE_ANALYTICS_PROPERTY_ID=
GOOGLE_ANALYTICS_CLIENT_ID=
GOOGLE_ANALYTICS_CLIENT_SECRET=
GOOGLE_ANALYTICS_REFRESH_TOKEN=
```

OAuth scope: `https://www.googleapis.com/auth/analytics.readonly`.

Never commit tokens, client secrets, or files under `.local/google-analytics/`. The client refreshes access tokens in memory and does not write token files. Errors redact secrets.

## Read-only client

Supported reads:

- Data API: `runReport` (paginated), `getMetadata`, `checkCompatibility`
- Admin: property, data streams, data retention, custom dimension/metric **definitions**, key events, Google Ads links, attribution settings, reporting identity

No GA mutation endpoints are implemented.

Retries: up to 4 attempts on HTTP 429/500/503 with exponential backoff. Other 4xx fail immediately.

## Snapshots

Sanitized payloads go to `source_snapshot` (`provider=google_analytics`) with hash dedupe on `(provider, entity_type, external_id, payload_hash)`. `observed_at` is import time.

Report snapshots keep family, property, date bounds, dimension/metric headers, rows (`dimensionValues`/`metricValues` only), `rowCount`, request count, quality flags, and limited quota counters.

Dropped: OAuth material, creator emails, Measurement Protocol secrets, arbitrary Google response fields, custom-dimension **values**.

Forbidden custom dimensions (`email_address`, `tel_number`, `wp_user_id`, `author`, including `customEvent:` names) are never requested. Their Admin definitions may be stored as `{ excluded: true }` without values.

Also never ingested: user IDs, client IDs, audience membership exports, demographics, arbitrary custom-dimension values.

## Canonical schema

Typed tables (not one table per API resource):

| Table | Grain |
| --- | --- |
| `analytics_property` | current property/stream/retention/attribution/identity |
| `analytics_key_event` | current key-event definitions from Admin |
| `analytics_daily_total` | property + farm date (site totals + ecommerce totals) |
| `analytics_session_acquisition` | date + session source/medium/channel |
| `analytics_first_user_acquisition` | date + first-user source/medium/channel |
| `analytics_landing_page` | date + `landingPage` |
| `analytics_page_path` | date + `pagePath` (not raw query-string URLs) |
| `analytics_event` | date + event name (custom **names** allowed; no event-parameter values) |
| `analytics_country` | date + country |
| `analytics_device` | date + deviceCategory |
| `analytics_ecommerce_item` | date + itemId |

GA metrics use `numeric(20,9)`. They are not Square integer minor units.

Reruns upsert on unique grains. Dimensional families now **replace** the property+date window after the provider report passes quality gates, so a grain Google no longer returns is removed. Daily totals still merge by owned component columns; a missing daily-component date nulls only that component. Source snapshots are versioned evidence and are not deleted.

## Historical coverage (production, through 2026-10-01)

Trusted canonical daily coverage:

| Period | Coverage |
| --- | --- |
| 2022 | **2022-04-13** only (known gap afterward) |
| 2023 | **2023-03-16..2023-12-31** (291 days; January, February, and early March absent) |
| 2024 | **2024-01-01..2024-12-31** (366 days) |
| 2025 | **2025-01-01..2025-12-31** (365 days) |
| 2026 | **2026-01-01..2026-10-01** (274 days; last completed farm day at backfill time) |

Do not manufacture missing dates. `goat_recess_booking` was absent in canonical event facts for 2023–2026-10-01; that does not reconstruct Admin key-event configuration history.

## Commands

Daily totals are split into three Data API requests (metric-count limit) then **merged by owned columns** onto `analytics_daily_total`:

1. **daily_totals** — `date` — sessions, activeUsers, newUsers, engagedSessions, engagementRate, bounceRate, eventCount, screenPageViews, keyEvents, averageSessionDuration (`site_totals_snapshot_id`)
2. **daily_engagement** — `date` — userEngagementDuration, totalUsers (`engagement_snapshot_id`)
3. **ecommerce_totals** — `date` — ecommercePurchases, transactions, purchaseRevenue, itemsPurchased, addToCarts (`ecommerce_totals_snapshot_id`)

A rerun of one component updates only that component's metric columns and snapshot FK. Missing ecommerce stays SQL NULL (not ingested / no provider row), never a synthesized `0`. A row is complete only when all three snapshot FKs are set. A failed later component must fail the chunk; it must not mark the combined row fully reconciled.

Live-validate before production (compatibility was previously proven in discovery, but definitions are still fail-closed if headers mismatch):

- `bounceRate` and `keyEvents` with session source/medium/channel
- `activeUsers` with `landingPage`
- `eventCount` with `pagePath`
- `keyEvents` with `eventName`
- `sessions` with country/device
- item metrics at `date` + `itemId`

Other families:

- session acquisition — sessions, engagedSessions, keyEvents, bounceRate
- first-user acquisition — newUsers, activeUsers
- landing page — sessions, engagedSessions, keyEvents, activeUsers
- page path — screenPageViews, eventCount, activeUsers
- event — eventCount, activeUsers, keyEvents
- country — sessions, activeUsers
- device — sessions, engagedSessions, activeUsers
- ecommerce item — itemsViewed, itemsAddedToCart, itemsPurchased, itemRevenue

Disabled: Google Ads campaign dimensions, Search Console fields in GA, demographics/Signals, realtime, audience exports.

## Pagination and quality

`runReport` uses limit 100000, offset until accumulated rows equal provider `rowCount`. Failures:

- incomplete page before `rowCount`
- `rowCount` changing across pages
- duplicate dimension keys
- more than 50 pages
- sampling (`samplingMetadatas`)
- `dataLossFromOtherRow`
- `subjectToThresholding` fails as `google_analytics_provider_thresholded_data_suppressed` (provider privacy suppression, not pagination or unresolved rows)

Empty successful reports are valid (including the ~2022-05 through 2023-02 tracking gap). Absence is not synthesized as zero facts.

`(not set)` is stored as a dimension value. Literal provider value `(other)` is stored. It is **not** the same as `dataLossFromOtherRow` (cardinality overflow that dropped data even from the other-row). Import already fails when `dataLossFromOtherRow=true`. A literal `(other)` with `dataLossFromOtherRow=false` means the remainder is in that row. `(other)` session/event rows are included when summing eventCount for recon (and when logging a sessions diagnostic).

Metric `0` is distinct from a missing row and from a not-yet-ingested component (NULL snapshot FK).

## Reconciliation

Per family (fail-closed): request succeeded, pagination complete, `rowCount` matches source rows, unique keys, expected headers, no unresolved rows, no sampling / `dataLossFromOtherRow` / thresholding.

GA `sessions` is an HLL++ estimated unique-count metric. The arithmetic sum of session-acquisition (or other dimensional) session rows is **not** guaranteed to equal date-grain sessions. Date-grain `analytics_daily_total.sessions` is canonical for total sessions. Acquisition rows remain canonical at their own grain. Cross-family session equality is **not** a reconciliation gate. A non-failing diagnostic is logged when both families exist and the sums differ.

Exact additive check (when both families were ingested in the window):

- site-component daily `eventCount` vs event-family `eventCount` sum, including `(other)` rows

Country/device session additivity is not enforced. Users, rates, durations, and first-user vs session acquisition are not additive. Item vs totals ecommerce is not enforced.

`analytics_property` / key-event Admin rows are **current-state as of snapshot `observed_at`**. They do not reconstruct 2022 retention, identity, or stream settings. Key-event `provider_create_time` is Google's create time and must not be used to treat earlier event names as key events.

## Commands

```bash
npm run import:google-analytics:dev -- --from 2023-03-01 --to 2023-03-07
npm run import:google-analytics:dev -- --from 2023-03-01 --to 2023-03-07 --admin-only
npm run backfill:google-analytics:dev -- --from 2022-04-13 --to 2023-03-31 --dry-run
npm run backfill:google-analytics:dev -- --from 2022-04-13 --to 2023-03-31
npm run increment:google-analytics:dev -- --dry-run
npm run increment:google-analytics:dev
npm run increment:google-analytics -- --dry-run
npm run increment:google-analytics
```

`--from` and `--to` are required inclusive America/Toronto property dates on **import** and **historical backfill**. Ranges before 2022-04-13 are rejected. The current farm day and future dates are rejected.

Backfill is weekly chunks, **oldest-to-newest**, restartable, fail-closed (stop on first failed chunk). Dry-run prints the plan only. There is no unbounded “everything ever” command.

The incremental CLI **rejects** `--from`/`--to`. Use backfill for an explicit historical range.

## Incremental refresh

GA attribution and key-event reporting can change after first collection. Incremental sync refreshes **four discrete completed America/Toronto farm dates**, not a rolling 14-day range:

- yesterday
- 3 days ago
- 7 days ago
- 14 days ago

If today is `2026-10-02` America/Toronto, that is `2026-10-01`, `2026-09-29`, `2026-09-25`, `2026-09-18`. Dates are deduplicated, sorted **oldest-to-newest**, and never include the current farm day. Dates before `2022-04-13` are skipped (logged), not requested.

This is intentionally bounded. Historical backfill remains a separate CLI. Incremental must not be used as a silent full-history crawler.

`--as-of YYYY-MM-DD` is a test/dev planning override: treat that civil date as “today” and still emit at most those four offsets. It is not a range backfill.

Dry-run (`--dry-run`) prints today, eligible dates, skips, family list. It makes **no** Google Data/Admin calls and **no** DB writes (including no advisory lock).

Live incremental:

1. PostgreSQL session advisory lock `google-analytics-incremental` (`pg_try_advisory_lock` on a reserved connection)
2. Admin current-state **once** (same sanitization/privacy as historical ingest; not historical Admin reconstruction)
3. Each eligible date as `startDate=endDate` through the existing importer (11 families, pagination, quality gates, recon)
4. Unlock

Fail-closed: any failed date returns nonzero, logs the farm date and gate/family when present, and does not mark the run successful. Earlier dates in the same run may already be persisted; the importer is not transactional across dates. Do not auto-broaden the set or retry indefinitely.

Recommended production cadence (**not installed**): once daily after the previous Toronto day is complete, e.g. **06:15 America/Toronto**. A second overlapping incremental process exits with `ga_incremental_already_running`. Do not run historical backfill concurrently with incremental.

Recovery after a failed date: fix the cause, then rerun `increment:google-analytics` (idempotent upsert/replace on the same four offsets for “today”), or run a **bounded** backfill `--from <failed> --to <failed>` if that single date must be repaired outside the incremental set.

### Sessions diagnostic

`sessions` is an HLL++ estimate. Dimensional session sums vs date-grain sessions are logged as diagnostics only and **do not** fail incremental or backfill. Exact additive recon remains `eventCount`.

### Replacement vs snapshots

Simple upsert left stale dimensional grains when Google later omitted a key. After quality/pagination pass, dimensional tables **delete then insert** only `property_external_id` + `farm_date` in the requested window for that family. An authoritative empty report clears that window. Other dates, properties, families, and `source_snapshot` / `source_identity` rows are untouched.

Daily totals: never delete the merged row when refreshing one component. Missing dates in that component null only that component’s metrics and stamp that component’s snapshot FK. Source evidence may grow on refresh (payload hash / quota metadata). Canonical grains stay unique. `source_identity` remains one row per `(provider, entity_type, external_id)`.

Admin config is current-state as of snapshot `observed_at`.

## Tracking gap

Property begins 2022-04-12. Useful reports start 2022-04-13. Traffic is largely absent ~2022-05 through 2023-02 and resumes 2023-03. Empty reports in that gap must PASS reconciliation. Do not manufacture zero rows.

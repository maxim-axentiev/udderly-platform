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

Reruns upsert on the unique grain and are idempotent.

## Report families

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
```

`--from` and `--to` are required inclusive America/Toronto property dates. Ranges before 2022-04-13 are rejected. The current farm day and future dates are rejected.

Backfill is weekly chunks, **oldest-to-newest**, restartable, fail-closed (stop on first failed chunk). Dry-run prints the plan only. Do not run production backfill from this implementation pass.

There is no unbounded “everything ever” command.

## Incremental refresh (next phase)

Attribution lookbacks from Admin (not hardcoded forever): acquisition 30 days, other conversions 90 days, reporting model paid-and-organic data-driven.

Refreshing only the last 3 days is **not** enough for conversion-heavy families. A later incremental importer should refresh at least:

- 7–14 completed days for traffic/session families
- ~30 completed days for session/first-user acquisition
- ~90 completed days for key-event / purchase families

No scheduler was added; run the bounded CLI when ready.

## Tracking gap

Property begins 2022-04-12. Useful reports start 2022-04-13. Traffic is largely absent ~2022-05 through 2023-02 and resumes 2023-03. Empty reports in that gap must PASS reconciliation. Do not manufacture zero rows.

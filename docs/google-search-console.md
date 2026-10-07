# Google Search Console

Read-only Search Analytics ingest for Udderly. Provider name: `google_search_console`.

This is a **sibling** of Google Analytics, not an extension of `analytics_*` tables or the GA client. Do not reuse GA or Google Business credentials.

## Property

- Domain property only: `sc-domain:udderlyridiculousfarmlife.com`
- Do not ingest the old URL-prefix property
- Earliest canonical date: **2026-09-30**
- Reporting calendar: Google Search Analytics civil dates (`gsc_date`) in **America/Los_Angeles**. Dates are **not** converted to America/Toronto farm dates.

## Credentials

Optional. The API starts without them. All four are required to import:

```
GOOGLE_SEARCH_CONSOLE_SITE_URL=
GOOGLE_SEARCH_CONSOLE_CLIENT_ID=
GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET=
GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN=
```

OAuth scope: `https://www.googleapis.com/auth/webmasters.readonly`.

Never commit tokens or files under `.local/google-search-console/`. The Nest client refreshes access tokens in memory and does not read `.local` credential files.

`GOOGLE_SEARCH_CONSOLE_SITE_URL` must be exactly `sc-domain:udderlyridiculousfarmlife.com`.

## Canonical ingestion

- `dataState=final` only. `dataState=all` is never requested by the importer.
- `searchType=web` only.
- Search appearance cannot be grouped with `date` (Google 400). The importer requests `searchAppearance` only, one reporting date at a time, and stamps `gsc_date` from that request.
- Metrics stored as Google returned them: clicks, impressions, CTR, position. CTR/position are **not** derived from dimensional sums.
- Pagination uses `startRow` until a short page. A full last page at the safety cap fails closed (no truncation).
- Empty API results are success with zero source rows. They do **not** fabricate zero metric facts.

## Coverage vs unpublished dates

A date is **published** only when `final` Search Analytics actually returned at least one row for it in the window.

Dates in the requested range with **no returned rows** are **possibly unpublished**. That is not inferred from “today − 2”. Those dates:

- still store report snapshots (empty evidence)
- **do not** replace existing canonical grains
- **do not** become fabricated zero rows

If offset 2 is empty `final`, incremental skips replacement and will try again at offset 3.

## Schema

| Table | Grain |
| --- | --- |
| `search_console_property` | current site / permission |
| `search_console_daily_total` | site + `gsc_date` |
| `search_console_query` | site + date + query |
| `search_console_page` | site + date + page |
| `search_console_country` | site + date + country |
| `search_console_device` | site + date + device |
| `search_console_search_appearance` | site + date + searchAppearance |

Snapshots: `source_snapshot` (`provider=google_search_console`, `entity_type=site|report`) with hash dedupe. Report `external_id` includes `final`.

Published-date refreshes **delete then insert** that site/date/family so stale dimensional rows disappear. Snapshots are not deleted.

## Reconciliation

Hard gates: request success, pagination complete, unique keys, `dataState=final`, `searchType=web`, source vs canonical row counts, no unresolved rows.

Diagnostics only (never fail the run): query, page, search appearance, country, and device clicks/impressions vs property daily totals. Query data is privacy-filtered. Page and search appearance are not additive. Country/device equality is not a permanent invariant.

## Commands

```bash
npm run import:google-search-console:dev -- --from 2026-09-30 --to 2026-10-04 --dry-run
npm run import:google-search-console:dev -- --from 2026-09-30 --to 2026-10-04
npm run import:google-search-console:dev -- --site-only --dry-run
npm run backfill:google-search-console:dev -- --from 2026-09-30 --to 2026-10-04 --dry-run
npm run increment:google-search-console:dev -- --dry-run
npm run increment:google-search-console:dev -- --as-of 2026-10-06 --dry-run
```

`--dry-run` for import, backfill, and increment is **planning-only**: no Nest boot, Google API, token refresh, database connection/write, advisory lock, or config refresh.

Incremental offsets: **2, 3, 7, 14** reporting-calendar days before Pacific today, oldest-to-newest. Dates before 2026-09-30 are skipped. `--from`/`--to` are rejected.

Live incremental takes PostgreSQL advisory lock `google-search-console-incremental`. A busy lock exits `gsc_incremental_already_running`.

No production schedule is installed.

There is no frontend or read API yet.

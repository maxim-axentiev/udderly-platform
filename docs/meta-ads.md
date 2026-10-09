# Meta Ads

Read-only Marketing API ingest for Udderly. Provider name: `meta_ads`.

This is a **sibling** of Google Analytics and Google Search Console, not an extension of those tables or clients. It is also not Facebook Page or Instagram ingest. Campaign *management* (create/update/pause ads) is out of scope: the Graph client is GET-only.

## Account

- Ad account: `act_1818645281666685`
- App id (documentation only, not an import env var): `4481084798772969`
- Reporting calendar: **America/Toronto** civil `metric_date`
- Currency: **CAD**, stored as integer minor units (`spend_amount`)
- Pinned Insights attribution: **`7d_click,1d_view`**. That string is part of every daily unique grain and insight snapshot `external_id`. Do not mix windows.

## Credentials

Optional. The API starts without them. Local tests use mocked Graph responses and **do not** need a working token. Do not generate, request, or commit tokens.

All-or-nothing when present. Both are required to import:

```
META_ADS_ACCOUNT_ID=act_1818645281666685
META_ADS_ACCESS_TOKEN=
```

`META_ADS_ACCOUNT_ID` must be exactly `act_1818645281666685`. A token without an account id (or the reverse) fails boot with `meta_ads_env_incomplete`.

Required Graph permissions for a later live import (not exercised in this phase):

- `ads_read` (Insights and object reads)
- Ad account access for `act_1818645281666685`
- Marketing API access on app `4481084798772969` (Advanced Access / system-user tasks as Meta requires)

Do **not** grant write tasks for ingest. The client never calls POST/PATCH/DELETE.

Never commit tokens or files under `.local/`. The client sends `Authorization: Bearer` and never puts `access_token` on the query string.

## Canonical ingestion

- Insights `time_increment=1` only. Multi-day `date_start` ≠ `date_stop` fails closed.
- Levels: account, campaign, ad set, ad.
- Pagination uses `paging.cursors.after` until exhausted. A missing cursor with `paging.next`, or a full last page at the safety cap, fails closed (no truncation).
- Empty API results are success with zero source rows. They do **not** fabricate zero metric facts.
- Insights `spend` is a major-unit decimal string; canonical money is CAD cents. Structure `daily_budget` / `lifetime_budget` stay in snapshots as Meta's minor-unit strings.

## Coverage vs unpublished dates

A date is **published for a level** only when that Insights level returned at least one row for it.

Dates in the requested range with **no returned rows at any level** are **possibly unpublished**. Dates returned at account level but missing at campaign/ad set/ad are **incomplete at that level** (diagnostic, not a gate).

Those unpublished or incomplete dates:

- still store insight snapshots (empty evidence)
- **do not** replace existing canonical grains at the incomplete level
- **do not** become fabricated zero rows

A global “any level had a row” flag must **not** wipe another level. Campaign replacement uses campaign rows only.

Published-date refreshes **delete then insert** that account/date/level/`7d_click,1d_view` so stale objects disappear for that level. Snapshots are not deleted. All insight levels for a window persist in **one transaction** after every level has been fetched successfully. Pagination truncation, 4xx, exhausted retries, or a missing level fail closed **before** replacement.

## Schema

| Table | Grain |
| --- | --- |
| `meta_ads_account` | current ad account |
| `meta_ads_campaign` | current campaign |
| `meta_ads_ad_set` | current ad set |
| `meta_ads_ad` | current ad |
| `meta_ads_account_daily` | account + `metric_date` + attribution window |
| `meta_ads_campaign_daily` | account + campaign + date + window |
| `meta_ads_ad_set_daily` | account + ad set + date + window |
| `meta_ads_ad_daily` | account + ad + date + window |

Snapshots: `source_snapshot` (`provider=meta_ads`, `entity_type=account|campaign|ad_set|ad|insight_report`) with hash dedupe. Insight `external_id` includes the pinned attribution window.

Migration `0010_meta_ads.sql` is committed for a later local apply. Do not run it against an existing database without explicit approval.

## Reconciliation

Hard gates: request success, pagination complete, unique keys, pinned attribution, source vs canonical row counts, no unresolved rows.

Diagnostics only (never fail the run): campaign / ad set / ad spend vs account spend. Reach and frequency are not additive.

## Commands

Explicit historical range (Toronto completed days only; rejects today/future):

```bash
npm run import:meta-ads:dev -- --from 2026-09-30 --to 2026-10-04 --dry-run
npm run import:meta-ads:dev -- --from 2026-09-30 --to 2026-10-04
npm run import:meta-ads:dev -- --account-only --dry-run
```

Rolling incremental (explicit completed offsets **1, 2, 3, 7, 14, 28** America/Toronto, oldest-to-newest). `--from`/`--to` are rejected.

```bash
npm run increment:meta-ads:dev -- --dry-run
npm run increment:meta-ads:dev -- --as-of 2026-10-20 --dry-run
npm run increment:meta-ads:dev -- --as-of 2026-10-20
npm run test:meta-ads
```

`--dry-run` is **planning-only**: no Nest boot, Graph API, token use, database connection/write, or lock.

## Operational safeguards

- Live bounded import and incremental take PostgreSQL advisory lock `meta-ads-import`. A busy lock exits `meta_ads_import_already_running`. They cannot overlap each other.
- Incremental fails closed on the first bad date and does not continue the remaining offsets.
- Attribution `7d_click,1d_view` is a hard reconciliation gate.
- No systemd timers in this phase. Do not schedule until a local live import has passed.

Migration `0010_meta_ads.sql` is applied on the isolated local Compose database (`udderly` / `udderly-postgres`) only. Do not apply it to production until a later authorized phase.

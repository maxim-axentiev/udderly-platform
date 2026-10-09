# Mailchimp

Read-only Marketing API 3.0 ingest for Udderly. Provider name: `mailchimp`.

This is a **sibling** of Google Analytics, Google Search Console, and Meta Ads. It is **not** subscriber CRM, consent matching, or email sending. Phase 1 stores **aggregate** audience and campaign reporting only.

This intentionally differs from the older `docs/data-model.md` roadmap that reserved Mailchimp for email join keys and `consent_event`. Those remain deferred. Do not import members, email addresses, names, or recipient-level activity.

## Credentials

Optional. The API starts without them. Local tests use mocked responses and **do not** need a working key.

```
MAILCHIMP_API_KEY=
```

Dedicated Goat Barn key only. **Never reuse the Wherewolf Mailchimp key.** Never commit the key. The client derives the data-center suffix from the key and sends HTTP Basic (`udderly` / key) on the `Authorization` header. The key is never placed on the query string.

## Read-only client

GET only. Forbidden path fragments (fail closed): `/members`, `/email-activity`, `/unsubscribed`, `/sent-to`, `/abuse-reports`, `/search-members`.

Allowed:

- `GET /3.0/` account `account_id`, `account_name`, `account_timezone` (stored as IANA `timezone`)
- `GET /3.0/lists` audience id, name, stats
- `GET /3.0/lists/{id}/growth-history`
- `GET /3.0/lists/{id}/activity` (daily, ~180 days, excludes Automation)
- `GET /3.0/campaigns?status=sent`
- `GET /3.0/reports`
- `GET /3.0/reports/{id}/click-details` (URL totals, not members)

Pagination uses `count`/`offset` plus `total_items`. Missing `total_items`, a short page before exhaustion, or the page cap fails closed (no truncation). 429/500/503 retry up to 4 times.

## Sanitization

Keep-lists drop owner email, names, `members`, `merge_fields`, and `share_report` (including `share_password`). `assertNoPii` fails closed if banned keys remain.

Allowed free text (treat as potentially sensitive, not PII of a person by default):

- audience `name`
- campaign `title`, `subject_line`, `preview_text`
- click `url` (userinfo stripped)

`tracking.google_analytics` is stored as an opaque string on `mailchimp_campaign.ga_campaign_name`. It is **not** GA attribution.

## Coverage vs unpublished dates

List activity dates with returned rows are **published** for that list. Dates in the requested range with no activity rows are **possibly unpublished** and do **not** replace existing daily grains.

Sent campaigns without a matching report are diagnostics. Existing `mailchimp_campaign_report` rows for those ids are **not** deleted.

Campaign report totals are revisable (opens keep accumulating). A later import with a new payload hash replaces that campaign’s report and link rows only. Empty click-details while the report still has unique clicks is treated as incomplete coverage: existing `mailchimp_campaign_link` rows are left in place.

All fetched resources for a window persist in **one transaction** after fetch-all succeeds.

## Schema

Migration `0011_mailchimp.sql` is applied on the isolated local Compose database (`udderly` / `udderly-postgres`) only. Do not apply it to production until a later authorized phase.

| Table | Grain |
| --- | --- |
| `mailchimp_account` | current account |
| `mailchimp_audience` | current list stats |
| `mailchimp_audience_monthly` | list + `year_month` |
| `mailchimp_audience_daily` | list + Toronto `metric_date` |
| `mailchimp_campaign` | campaign id |
| `mailchimp_campaign_report` | campaign id (current totals) |
| `mailchimp_campaign_link` | campaign + link id |

## Timezone policy

Canonical reporting dates (import windows, incremental offsets, activity `metric_date`, campaign send civil dates) are always **America/Toronto**.

Mailchimp `account_timezone` may be **America/Toronto** or **America/New_York**. Those IANA zones currently share the same UTC offsets and DST transitions, so civil dates match. The stored account row keeps Mailchimp’s IANA name; it is not rewritten to Toronto.

Missing, empty, unknown, or other zones (`America/Chicago`, `UTC`, abbreviations such as `EST`) fail closed. Do not treat offset-equivalent labels as approved unless they are on that explicit list. If Mailchimp and Toronto ever diverge, update the allowlist rather than inferring compatibility.

## Commands

```bash
npm run import:mailchimp:dev -- --from 2026-09-30 --to 2026-10-04 --dry-run
npm run import:mailchimp:dev -- --account-only --dry-run
npm run increment:mailchimp:dev -- --dry-run
npm run increment:mailchimp:dev -- --as-of 2026-10-20 --dry-run
npm run test:mailchimp
npm run test:mailchimp-db
```

`--dry-run` is **planning-only**: no Nest boot, Mailchimp HTTP, key use, database, or lock. Incremental **rejects** `--from`/`--to`; use `import:mailchimp` for an explicit historical range.

Live import and incremental share PostgreSQL advisory lock `mailchimp-import`. A busy lock exits `mailchimp_import_already_running`. They cannot overlap each other.

No systemd timers in this phase. No production migrate.

## Incremental refresh policy

Rolling incremental (America/Toronto, oldest-to-newest):

- **List activity** on completed offsets **1, 2, 3, 7, 14, 28**. Only dates with returned activity rows are replaced. Empty/unpublished dates are diagnostics and do not delete existing daily grains.
- **Campaign reports and link totals** for sent campaigns whose Toronto send date falls in a **contiguous 28-day lookback** (oldest offset through yesterday). That catches revisable unique opens and clicks on send dates that are not activity offsets.
- Account and audience aggregate stats are upserted on each live step.

Limitations:

- Campaigns sent more than 28 days ago are not refreshed by incremental. Repair them with a bounded `import:mailchimp --from --to`.
- List activity older than offset 28 is not revisited daily (Mailchimp activity itself is only ~180 days and excludes Automation).
- Incremental is not a backfill and must not run against the current Toronto day.

Recommended production cadence (**not installed**): once daily after the previous Toronto day is complete. Recovery: rerun `increment:mailchimp` (idempotent) or a bounded import for a single failed date.

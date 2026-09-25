# Square integration

Read-only production connection. Square is the source for physical farm-store catalog and retail commerce. Catalog and commerce ingest are **manual two-step** commands (snapshot, then normalize). Historical commerce backfill is a **manual** command that runs those same steps plus reconcile, one farm-calendar month at a time. There is no Square webhook receiver and no recurring poller.

This repository does **not** ingest Square customers as people. Instant Profile `customer_id` may be stored as an unresolved `source_identity` only.

## Environment variables

Set these in the repository root `.env` file. They are optional: the API starts without them.

```
SQUARE_ACCESS_TOKEN=
SQUARE_APPLICATION_ID=
SQUARE_LOCATION_ID=
```

If any of the three is missing, Square reports as not configured. The access token is a production credential. Never commit it, never print it, and never log `Authorization` headers.

`SQUARE_APPLICATION_ID` and `SQUARE_LOCATION_ID` are not returned from public status endpoints.

## How the connection works

The API uses Square’s production REST host `https://connect.squareup.com` with `Square-Version: 2026-08-19`. Requests send `Authorization: Bearer <token>` over HTTPS. There is no official Square Node SDK in this repo; a small fetch client is enough for read-only list/search calls.

Read endpoints used by the audit:

- `GET /v2/locations`
- `POST /v2/orders/search`
- `GET /v2/payments`
- `GET /v2/refunds`
- `POST /v2/customers/search`
- `GET /v2/catalog/list`
- `GET /v2/customers/groups`
- `GET /v2/customers/segments`
- `GET /v2/customers/custom-attribute-definitions`

The client paginates with Square `cursor` values until the last page, retries HTTP 429 with backoff, and uses a 30-second timeout. Errors redact the access token if it ever appears in a message.

This integration is read-only. It does not create orders, refunds, customers, catalog changes, or Square webhooks.

## Connection status

With the API running:

```
http://localhost:3001/integrations/square/status
```

Example when configured and reachable:

```json
{
  "provider": "square",
  "configured": true,
  "connected": true
}
```

If the variables are missing, `configured` is `false` and `connected` is `false`. The response never includes credentials, location IDs, application IDs, customers, or transactions.

## Audit command

From the repository root:

```
npm run audit:square
```

This uses the real production Square account from `.env`. Default window for orders, payments, and refunds is the last 30 days at the configured location. Catalog and customer-directory structure are inspected without dumping personal data. Two small older date windows are probed for historical access; the full account history is not downloaded.

### What the audit prints

- whether credentials are configured and the API responded
- accessible locations (names/status/country/currency; no address)
- order, payment, and refund counts and status mix
- customer-id linkage percentages
- catalog item, variation, and category names and ID presence
- stable ID fields observed for joins
- field paths and types (not values) for structure

### What the audit does not print

- customer names, emails, phones, addresses, notes
- payment card numbers, last four digits, fingerprints, billing addresses
- receipt URLs
- refund free-text reasons
- raw API payloads
- access tokens or Authorization headers

Product, variation, and category names are business data and are printed.

No audit files are written. Do not save raw Square responses into the repo. If temporary local notes are ever needed, use gitignored `.local/`.

## Pagination

List/search endpoints return a `cursor` when more results exist. The client repeats the same request with that cursor until Square omits it. SearchOrders uses a page size of 500; payments and refunds use 100; customers use 100. Catalog List returns up to 1,000 objects per page and is followed until Square omits `cursor` (or `SQUARE_MAX_PAGES` is exceeded, which fails rather than truncating).

## Manual catalog import

Read-only `GET /v2/catalog/list?types=CATEGORY,ITEM,ITEM_VARIATION` (Square-Version `2026-08-19`). Production command runs compiled dist JS:

```
npm run import:square-catalog
npm run normalize:square-catalog
```

`:dev` variants use `tsx`. Import writes sanitized `source_snapshot` rows only. Normalize is a separate command.

### Snapshots

`provider = square`. `entity_type` is `category`, `item`, or `item_variation`. `external_id` is the CatalogObject id. Identical sanitized JSON reuses the existing `(provider, entity_type, external_id, payload_hash)` row.

Sanitized fields:

| Type | Fields |
| --- | --- |
| CATEGORY | `id`, `type`, `version`, `updated_at`, `is_deleted`, `is_archived`, `name` |
| ITEM | plus `category_ids`, `variation_ids` |
| ITEM_VARIATION | plus `item_id`, `sku` |

Category membership prefers `item_data.categories[].id` (current API). If that collection is empty, fall back to deprecated `item_data.category_id`. `reporting_category` is not merchandising membership and is ignored. Nested `item_data.variations` are also snapshotted as `item_variation` rows.

No customer data. No raw leftover Square fields (prices, descriptions, location flags).

### Canonical mapping

| Square | `source_identity` | Canonical |
| --- | --- | --- |
| CATEGORY id | `square` / `category` / id | `product_category` |
| ITEM id | `square` / `item` / id | `product` |
| ITEM_VARIATION id | `square` / `item_variation` / id | `product_variation` |
| item category ids | — | `product_category_assignment` |

Identity is always the Square CatalogObject id. Names may duplicate. SKU is nullable and never used as identity.

### Status

| Square | Canonical `status` |
| --- | --- |
| `is_deleted = true` | `deleted` |
| else `is_archived = true` | `archived` |
| else | `active` |

Deleted/archived objects are retained. They are never hard-deleted.

Historical catalog recovery snapshots set `historical_recovery = true`. If Square reports `is_deleted`, canonical status is `deleted`. Otherwise a recovered historical version is stored as `archived` so it can resolve old sale lines without claiming the object is currently active. An older recovered version never overwrites a newer canonical row.

### Assignments

Latest item snapshot category ids are synchronized onto `product_category_assignment` (insert current, delete memberships no longer present). Uncategorized items are valid. Unresolved Square category ids are counted, not invented. Removing an assignment does not delete the category or product.

### Transactions

Each category snapshot applies in its own transaction. Each item snapshot applies in one transaction that also applies that item’s variation snapshots. Remaining variations apply in their own transactions. A variation whose parent item identity does not exist writes nothing.

Newest snapshot per Square id is selected by provider catalog `version`, then `observed_at` only as a tiebreaker. Applying an older catalog version is `skipped_stale`, even if that snapshot was observed later (historical recovery runs today). `observed_at` alone must not roll a newer canonical product or variation backward.

### Historical catalog recovery (manual)

```
npm run recover:square-catalog -- --from 2026-06-01 --to 2026-06-30
npm run recover:square-catalog -- --date 2026-06-15 --dry-run
```

Production uses compiled dist JS. Local iteration may use `recover:square-catalog:dev`. This is not scheduled.

It finds latest farm-window order snapshots whose line items have a `catalog_object_id` that does not resolve `square / item_variation / <id>` and that include a usable `catalog_version`. Pairs are `(catalog_object_id, catalog_version)` — the same object at two versions is two requests. Output is aggregate-only (no Square ids, names, or order ids).

`--dry-run` reads the database only: no Square API calls and no writes.

Live recovery `POST`s `/v2/catalog/batch-retrieve` grouped by `catalog_version`, with `include_deleted_objects` and `include_related_objects`. Requested ids must come back as `ITEM_VARIATION`. Unexpected types and missing objects are counted, not invented. Related parent `ITEM` objects are stored when present. Nested related variations are not snapshotted unless they were requested.

Existing sanitization and `source_snapshot` hash dedupe apply. Recovery does **not** run `normalize:square-catalog`, commerce normalize, or reconcile. After recovery, run those manually.

Synthetic tests:

```
npm run test:square-catalog
npm run test:square-catalog-recovery
```

## Manual commerce import

Farm calendar dates are `America/Toronto`. Production commands run compiled dist JS:

```
npm run import:square-commerce -- --date 2026-09-15
npm run normalize:square-commerce -- --date 2026-09-15
npm run reconcile:square-commerce -- --date 2026-09-15
```

Also `--from YYYY-MM-DD --to YYYY-MM-DD` (inclusive). `:dev` variants use `tsx`. Import writes sanitized `source_snapshot` rows only. Normalize is a separate command. Reconcile is **read-only**: it compares those snapshots to canonical rows and writes nothing. Fetch uses the existing location id and follows Square cursors until omitted.

`--date 2026-09-15` for **orders** means Square `closed_at` in that America/Toronto farm day (half-open UTC). That matches `sale.occurred_at` (`closed_at` when present). SearchOrders uses `date_time_filter.closed_at` (Square allows only one of created_at / updated_at / closed_at per request). COMPLETED and CANCELED orders that closed that day are included, even if `created_at` was earlier. An order created that day but closed the next day is **not** a sale for `--date`. OPEN/DRAFT orders typically have no `closed_at` and are **not** fetched by this command; they are not mixed into historical closed-sale reporting.

Payments and refunds are still selected by their own ListPayments/ListRefunds `begin_time`/`end_time` (`created_at`). Normalize uses the same split: orders by snapshot `closed_at`, payments/refunds by `created_at`.

### Payment order dependency recovery (manual)

```
npm run recover:square-payment-orders -- --from 2026-05-01 --to 2026-05-31
npm run recover:square-payment-orders -- --date 2026-05-15 --dry-run
```

Production uses compiled dist JS. Local iteration may use `recover:square-payment-orders:dev`. This is not scheduled.

A payment can reference `payment.order_id` for an order whose `closed_at` is outside the requested payment window (for example a May payment on an April order). Monthly SearchOrders by `closed_at` will not have stored that snapshot. This command finds latest farm-window **payment** snapshots that:

- have `order_id`
- do not already resolve `square / payment / <id>` to a canonical payment
- have no `square / order / <order_id>` snapshot

It then `POST`s `/v2/orders/batch-retrieve` with those exact order ids (up to 100 per request). Output is aggregate-only (no payment ids or order ids). Missing returned ids are counted, not invented. Closed-at is reported as before / inside / after the requested payment window, or missing.

`--dry-run` reads the database only: no Square API calls and no writes.

Existing order sanitization and `source_snapshot` hash dedupe apply. Recovery does **not** run commerce normalize, reconcile, or catalog recovery. After recovery, run `normalize:square-commerce` then `reconcile:square-commerce` for the payment window.

Normalize, when attaching a payment, will apply that exact latest order snapshot as a **dependency** if a canonical sale is still missing — even when `order.closed_at` is outside the payment window. The sale keeps `occurred_at = closed_at`. Non-sale classifications (`return_only`, `return_adjustment_non_sale`, `invalid_order_money`) still create no sale; the payment stays unresolved. Unresolved catalog ids on dependency lines keep the line with null product refs.

Synthetic tests:

```
npm run test:square-payment-order-recovery
```

### Snapshots

`provider = square`. `entity_type` is `order`, `payment`, or `refund`. `external_id` is the Square id. Identical sanitized JSON reuses `(provider, entity_type, external_id, payload_hash)`.

Sanitized order fields: `id`, `location_id`, `state`, `created_at`, `updated_at`, `closed_at`, `version`, `customer_id` (unresolved evidence only), `source.name`/`type`, top-level original money (`total_money`, `total_tax_money`, `total_discount_money`, `total_tip_money`, `total_service_charge_money`), `net_amounts` as post-return evidence, top-level `return_amounts` (same money parts), `returns` summaries (`uid`, `source_order_id`, `return_amounts`, and counts of return line items / discounts / taxes / service charges / tips), `line_items` (uid, catalog ids/version, names, quantity, money parts, modifier name/price only), `tenders` (`id`, `type`, `payment_id` only). No notes, fulfillments, customer contact, or nested return names.

Sanitized payment fields: `id`, `order_id`, `location_id`, `status`, timestamps, `customer_id`, `source_type`, `amount_money`, `total_money`, `tip_money`, `refunded_money`, `approved_money`, signed `processing_fee[]` (`type`, `effective_at`, `amount_money`). Derived `processing_fee_amount` is the nonnegative **net** cost when `sum(signed amounts) ≥ 0`. Production INITIAL amounts are positive (merchant fee cost). A negative net is a fee credit: `processing_fee_invalid = net_credit`, `processing_fee_amount` left null, counted as “Net fee credits not representable”. No card PAN/last4/fingerprint, cardholder name, receipt URLs, billing address, email, or phone.

Sanitized refund fields: `id`, `payment_id`, `order_id`, `location_id`, `status`, `amount_money`, timestamps. No reason text.

### Canonical mapping

| Square | `source_identity` | Canonical |
| --- | --- | --- |
| order.id | `square` / `order` / id | `sale` (`kind=retail`) |
| order line uid | `square` / `order_line` / `<order.id>:<uid>` | `sale_line_item` |
| order line without uid | `square` / `order_line` / `<order.id>:version:<order.version>:pos:<index>` | `sale_line_item` |
| payment.id | `square` / `payment` / id | `payment` |
| refund.id | `square` / `refund` / id | `refund` |
| customer.id | `square` / `customer` / id | unresolved (`internal_*` null) |

A Square provider order can represent:
- a canonical sale
- return-only evidence
- return-adjustment non-sale evidence
- an invalid/unrepresentable order

Only canonical sales create `sale` rows.

- Original/gross order (usable top-level `total_money`) → `sale`. Zero line items is still a sale if gross money is present. Do not invent a fake line.
- Return-only order (no usable top-level `total_money`, `net_amounts.total_money` < 0) → **not** a sale. Keep the `source_snapshot`. Do not create a $0 or negative sale. Do not abs the net amount.
- Return-adjustment non-sale (no usable top-level `total_money`, valid net total = 0, empty current lines, at least one `returns[]` object, and explicit `return_amounts` and/or returned component counts) → **not** a sale. Keep the snapshot. Do not treat arbitrary zero-net orders this way.
- Other missing/unusable gross money → skip as invalid/unrepresentable order money and count it.

`sale` is not `payment`. Refunds are not negative payments. A Square **refund** still creates a canonical `refund` even when a related return-only or return-adjustment order is skipped.

Ordinary normalize does not delete legacy sales that were incorrectly created from return-only orders.

### Money

Canonical Square **sale** fields are original/gross order economics from **top-level** Order money, excluding tip. All integers, minor units, plus ISO currency.

| Canonical | Square |
| --- | --- |
| `sale.discount_amount` | `total_discount_money` |
| `sale.tax_amount` | `total_tax_money` |
| `sale.service_charge_amount` | `total_service_charge_money` |
| `sale.total_amount` | `total_money` **minus** explicit `total_tip_money` once |
| `sale.subtotal_amount` | `total_amount - tax - service_charge + discount` (Square has no separate order subtotal) |
| `payment.amount` | `amount_money` (excludes tip; not `total_money`) |
| `payment.tip_amount` | `tip_money` |
| `payment.processing_fee_amount` | `sum(processing_fee[].amount_money.amount)` when that sum is ≥ 0. Production INITIAL amounts are **positive** merchant fee cost. Negative ADJUSTMENT entries reduce the net. Do **not** abs or invert signs. A negative net is a fee credit: reported, `processing_fee_amount` left null. |
| `refund.amount` | `amount_money` (positive) |

`net_amounts` is post-return/net provider evidence. It is stored on the snapshot but **must not** set canonical sale fields. Using `net_amounts` as the sale total plus recording refunds would count returns twice.

Square return-only orders (no usable top-level `total_money`, negative `net_amounts.total_money`) stay as snapshot evidence only. Return-adjustment non-sales (zero net total with explicit sanitized return evidence) also stay as snapshot evidence only. Canonical refunds come from the Refunds API, not from abs(net) or a $0 sale.

Reporting:

- gross sales = `sale.total_amount`
- refunds = `refund.amount`
- net sales = gross sales − refunds

Tip is never guessed and never sale revenue (`payment.tip_amount` only). Processing fees never change `sale.total_amount`. Refunds never change `sale.total_amount`.

### Order status

Provider `state` is stored lowercased (`COMPLETED` → `completed`, `CANCELED` → `canceled`). Canceled orders are retained. Reporting chooses whether to include them. They are not treated as revenue by this ingest.

### Line items

`catalog_object_id` resolves `square` / `item_variation` / id → `product_variation` → `product`. A line with no usable `catalog_object_id` is a custom/non-catalog line: it still creates `sale_line_item` with null product FKs. A line that has a catalog id but cannot resolve that exact variation identity is an unresolved catalog line. Quantity is Square’s decimal string. Identity is order id + Square line `uid`. Lines without uid use `<order.id>:version:<order.version>:pos:<index>` so a later version cannot reuse an older positional identity. Description is not identity.

The latest order payload is the current line set. Lines no longer present are `is_active=false` with `removed_at` set (`0007_sale_line_item_lifecycle`; `0006` untouched).

### Payments and refunds

Payments resolve sale by exact `order_id`. Unresolved payments do not invent a sale. `source_type` maps `CARD`/`CASH`/`EXTERNAL` → `card`/`cash`/`external`; anything else explicit → `other`. EXTERNAL is a tender type, not unpaid.

Refunds resolve `payment_id` first (copy that payment’s `sale_id`), else exact `order_id`. Amounts stay positive.

### Customers

No PERSON. `customer_id` becomes unresolved `source_identity`. No Instant Profile matching against FareHarbor/Wherewolf.

### Transactions and idempotency

One transaction per order (sale + current lines + identities). One transaction per payment. One transaction per refund. Newest snapshot (`observed_at`, then `updated_at`, then `version`) wins; older apply is `skipped_stale`. Unchanged sanitized payloads do not insert extra snapshots.

Normalize order: latest orders in the farm window, then payments, then refunds. The CLI reports `Custom/non-catalog lines` separately from `Unresolved catalog lines`. It also reports `Return-only orders skipped`, `Return-adjustment non-sales skipped`, `Invalid order money skipped`, and `Dependency orders applied` separately. Ordinary normalize does not delete previously created sales. Already-canonical dependency sales are reused and are not counted as newly applied.

### Reconciliation (read-only)

```
npm run reconcile:square-commerce -- --from 2026-09-09 --to 2026-09-15
npm run reconcile:square-commerce -- --date 2026-09-12
```

Compares latest `source_snapshot` rows in the America/Toronto farm window to canonical sales, lines, payments, and refunds. It does not write. Money rules are the same as normalize (gross top-level sale totals excluding tip; return-only and return-adjustment non-sales are not sales; payment `amount_money` / `tip_money`; nonnegative net processing-fee cost; separate refunds).

PASS requires matching source/canonical counts and money, `Invalid orders: 0`, and `Unresolved variations: 0`. Custom/non-catalog lines are valid and do not fail. Return-only orders and return-adjustment non-sales are valid provider records and do not fail. Inactive lines do not fail when they match the current source line set. FAIL prints aggregate differences only (no Square ids, customer ids, names, or payloads) and exits nonzero.

### Historical commerce backfill (manual)

```
npm run backfill:square-commerce -- --from YYYY-MM-DD --to YYYY-MM-DD
npm run backfill:square-commerce -- --from YYYY-MM-DD --to YYYY-MM-DD --dry-run
```

Production uses compiled dist JS (`backfill:square-commerce`). Local iteration may use `backfill:square-commerce:dev`.

This is not scheduled and does not invent products or catalog mappings. It reuses existing import, normalize, and reconcile services. Inclusive America/Toronto farm dates are split into calendar-month chunks and processed **newest to oldest**. Mid-month `--from` / `--to` clip the first and last months.

`--dry-run` prints the chunk list and performs no Square API calls and no database writes (it does not start the Nest app).

Each live chunk is import → normalize → reconcile. The existing reconcile verdict is the gate. On import/normalize throw or reconcile FAIL, the runner stops, prints the failed chunk dates, and exits nonzero. Older chunks are not started. A rerun is safe: snapshots deduplicate by hash, normalize is idempotent, and there is no extra backfill checkpoint store.

The already-proven production window is 2026-08-17 through 2026-09-15. Choose `--to` before that range for the first historical run. Do not assume a fixed earliest Square date; pass `--from` explicitly.

An unresolved catalog-bearing line still FAILs reconcile and stops the backfill. Inspect that historical catalog id separately; do not fuzzy-match or re-import catalog every month.

### Return evidence inspect (read-only)

```
npm run inspect:square-commerce -- --date 2026-08-28
```

Reads latest sanitized order snapshots in the farm window and prints aggregate return evidence only: orders with `returns` / `return_amounts`, return object and component counts, and summed `return_amounts` / `net_amounts`. It does not write. It does not print Square ids, `source_order_id` values, names, customer data, or raw payloads. Re-importing an order after a sanitizer change may insert a new snapshot hash; inspect uses the latest payload.

Synthetic tests (no live Square API):

```
npm run test:square-commerce
npm run test:square-backfill
```

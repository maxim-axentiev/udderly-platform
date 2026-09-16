# Square integration

Read-only production connection and data audit only. Square is intended as the future source for physical farm-store transactions and retail activity. This repository does **not** ingest Square orders, payments, customers, refunds, or sales yet. Catalog import/normalize is manual.

There is no Square webhook receiver and no recurring sync job.

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

### Assignments

Latest item snapshot category ids are synchronized onto `product_category_assignment` (insert current, delete memberships no longer present). Uncategorized items are valid. Unresolved Square category ids are counted, not invented. Removing an assignment does not delete the category or product.

### Transactions

Each category snapshot applies in its own transaction. Each item snapshot applies in one transaction that also applies that item’s variation snapshots. Remaining variations apply in their own transactions. A variation whose parent item identity does not exist writes nothing.

Newest snapshot per Square id (by `observed_at`, then catalog `version`) is selected. Applying an older snapshot is `skipped_stale`.

Synthetic tests (no live Square API):

```
npm run test:square-catalog
```

# Operational schema (Phase 1)

PostgreSQL tables from migrations `0002_operational_core` through `0007_sale_line_item_lifecycle`. FareHarbor webhooks fill `integration_events` only. Wherewolf pulls fill `source_snapshot` (sanitized). FareHarbor Booking details CSVs are **not** stored. Square catalog and Square commerce ingest are **manual** two-step commands. Design: `docs/data-model.md`.

## Tables

| Table | Role |
| --- | --- |
| `source_identity` | Provider ids; internal target optional |
| `experience` | Canonical Udderly offering |
| `experience_source_mapping` | Provider catalog object → experience |
| `session` | Dated occurrence of an experience |
| `booking` | FareHarbor booking (operational) |
| `booking_contact` | Booker (PII) |
| `booking_party_member` | Expected participant |
| `visit` | Actual attendance (PII geography/demographics) |
| `source_snapshot` | Sanitized pull-API copies (Wherewolf) |
| `source_object_classification` | Explicit non-experience provider objects (FH report labels) |
| `sale` | Commercial/revenue document |
| `sale_line_item` | What was sold |
| `payment` | Money received (not revenue) |
| `refund` | Reversal (positive amount, not a negative payment) |
| `product_category` | Canonical catalog category |
| `product` | Canonical catalog item (archive in place) |
| `product_variation` | Sellable variation / SKU holder |
| `product_category_assignment` | Many-to-many product ↔ category |

Plus existing `platform_meta` and `integration_events`.

## Money

All canonical monetary columns are **integer minor units** plus a 3-letter `currency` code (`CAD` today; never assume CAD forever). Example: CAD $12.34 = `1234`. Never float/double/decimal dollars.

`sale.total_amount` is the sale value. **Do not** `SUM(sale.total_amount) + SUM(payment.amount)` for revenue. Payment is cash movement; refund is reversal.

Tips: `payment.tip_amount` only. Processing fees: `payment.processing_fee_amount` only. Neither is subtracted from or added into `sale.total_amount`.

## `sale`

Revenue document. Not a provider “order”.

- `kind`: `experience` (FareHarbor) or `retail` (Square)
- `booking_id` unique nullable. Experience sales **must** have a booking (`sale_experience_has_booking`). Retail sales leave it null. At most one sale per booking.
- `experience_id` / `session_id` nullable (copied from the booking when known)
- `source_type` nullable channel
- Amounts: `subtotal_amount`, `discount_amount`, `tax_amount`, `service_charge_amount`, `total_amount`
- `occurred_at` is the business time of the sale (not `created_at`)
- No `amount_paid` column (that would duplicate `payment`)
- No `person_id`

Provider ids: Square `order.id` → `source_identity` (`square` / `order` / `<id>` → `sale`). FareHarbor has **no** order id; the sale is found via `sale.booking_id` (and later `fareharbor` / `payment` / `<pk>` on payments).

Later mapping: FH `receipt_subtotal` / `receipt_taxes` / `receipt_total`. Square **top-level** order totals excluding tip for original sale economics; Square refunds are separate (`docs/square.md`). Do not use `net_amounts` as canonical sale totals.

## `sale_line_item`

`sale_id` required. `product_id` / `product_variation_id` / `experience_id` nullable (unmapped historical lines are allowed). `description` is a safe name snapshot. `quantity` is `numeric(12,4)` because Square quantities are decimal strings, not guaranteed integers.

Line amounts: `gross_amount` (before discount), `discount_amount`, `tax_amount`, `total_amount`, plus `currency`.

Square order updates expose the **current** `line_items` array. `0007_sale_line_item_lifecycle` adds `is_active`, `last_seen_at`, and `removed_at` (same pattern as `booking_party_member`). A line missing from the latest order snapshot is deactivated, not hard-deleted. Reporting current mix should use `is_active = true`. `0006_commerce` is unchanged.

## `payment` / `refund`

`payment.sale_id` is required. `amount` is cash applied to the sale **excluding** tip (`Square amount_money`, not `total_money`). `tip_amount` defaults to 0. `processing_fee_amount` is the nonnegative **net** Square fee cost (`sum(signed processing_fee amounts)` when that sum is ≥ 0; production INITIAL amounts are positive). A negative net credit is reported and left null, not stored as a fee. No card PAN/last4/fingerprints/receipt URLs.

`refund` amounts are positive integer minor units with an explicit 3-letter `currency` on the refund row (not inferred from payment/sale). Either `sale_id` or `payment_id` (or both) must be set. Not modeled as negative payments.

## Catalog

`product_category` / `product` / `product_variation` / `product_category_assignment`. A product may belong to **many** categories (Square items can). There is no `product.category_id` and no primary category. Assignment FKs are `ON DELETE RESTRICT`. Composite primary key `(product_id, category_id)`; extra index on `category_id`. `status` is `active` / `archived` / `deleted` (Square `is_deleted` never hard-deletes). SKU on variation, indexed, **not** unique. Provider catalog ids stay in `source_identity` (`category`, `item`, `item_variation`). Square item category membership fills `product_category_assignment`.

## `source_snapshot`

Pull-API copies. Unique `(provider, entity_type, external_id, payload_hash)` so the same sanitized source state is stored once; a later different hash is a new observation. Indexed `(provider, entity_type, external_id, observed_at)` for latest-state lookups.

`observed_at` is the time Goat Barn imported/observed the source record. It is **not** the visit/business date.

Wherewolf payloads are sanitized before insert (no DOB, signatures, IP, street, full postal/ZIP, guardian, or medical fields). `visit.postal` is left null for this phase.

Square catalog snapshots are sanitized CatalogObject subsets (`square` / `category` \| `item` \| `item_variation`). Square commerce snapshots are sanitized Orders/Payments/Refunds API subsets (`order`, `payment`, `refund`). See `docs/square.md`.

## `source_identity`

Unique `(provider, entity_type, external_id)`.

`internal_entity_type` and `internal_entity_id` are **nullable together** (check `source_identity_internal_pair`). They are polymorphic: PostgreSQL does **not** foreign-key them to `booking` / `visit` / `experience` / `sale`. Application code must keep them consistent when set.

Example unresolved: `square` / `customer` / `<id>` with both internal columns null.

Intended commerce identities (when ingest exists):

| Provider | `entity_type` | Resolves to |
| --- | --- | --- |
| square | `order` | `sale` |
| square | `payment` | `payment` |
| square | `refund` | `refund` |
| square | `category` | `product_category` |
| square | `item` | `product` |
| square | `item_variation` | `product_variation` |
| fareharbor | `payment` | `payment` |
| fareharbor | `refund` | `refund` |

Do **not** invent a FareHarbor order identity.

## `experience_source_mapping` vs `source_identity`

| | `source_identity` | `experience_source_mapping` |
| --- | --- | --- |
| Purpose | Any provider id we have seen | This FH item / WW activity / Sanity doc **is** this experience |
| Canonical FK | None (polymorphic) | `experience_id` → `experience` `ON DELETE RESTRICT` |
| Unresolved allowed | Yes | No (`experience_id` required) |

Item/activity mappings live here, not as a second copy in `source_identity`.

FareHarbor items are mapped with:

```
npm run map:fareharbor-experience -- --item-id <pk> --name "Miniature Donkey Visits"
npm run map:fareharbor-experience -- --item-id <pk> --experience-id <uuid>
```

Rows use `provider = fareharbor`, `provider_object_type = item`, `external_id` = item PK as text. `external_label` is the provider item name, not the canonical `--name`. The mapping CLI leaves it null; the FareHarbor normalizer may fill it from `availability.item.name`. The command is idempotent. It will not overwrite an item that already maps to a different experience.

FareHarbor Booking details CSV item labels (not item PKs) are mapped with:

```
npm run map:fareharbor-report-item -- --item-label "Goat Recess" --name "Goat Recess"
npm run map:fareharbor-report-item -- --item-label "Goat Recess" --experience-id <uuid>
```

Rows use `provider = fareharbor`, `provider_object_type = report_item_label`, `external_id` = exact CSV `Item` text. Labels that are not experiences are classified, not mapped:

```
npm run classify:fareharbor-report-item -- --item-label "Gift Card" --non-experience
```

That writes `source_object_classification` (`classification = non_experience`). Report-derived sessions use `source_identity` `entity_type = availability_report_key`, which is **not** a FareHarbor availability PK.

Wherewolf activities are mapped with:

```
npm run map:wherewolf-experience -- --activity-id <id> --name "Farm Glamping"
npm run map:wherewolf-experience -- --activity-id <id> --experience-id <uuid>
```

Rows use `provider = wherewolf`, `provider_object_type = activity`, `external_id` = activity id as text from `activitiesAsObjects.id` or guest `activities` string ids.

## Foreign keys

All business FKs use **`ON DELETE RESTRICT`** so archiving/deleting an experience, product, or sale cannot silently drop history.

`booking.rebooked_from_booking_id` / `rebooked_to_booking_id` reference `booking`.

`booking_party_member.source_identity_id` points at a stable FareHarbor `customer` `source_identity`. That identity stays **unresolved** (`internal_entity_type` / `internal_entity_id` null). There is no PERSON table yet. Party membership is the FK from `booking_party_member` to `source_identity`, not a resolution onto a person.

Removed participants keep their row: `is_active = false`, `removed_at` set, `last_seen_at` unchanged from the last payload that included them.

## No FareHarbor UUID on `booking`

Idempotency is `source_identity` (`fareharbor` / `booking` / uuid). Raw payloads stay in `integration_events`. There is no `booking.sale_id`; look up the sale by unique `sale.booking_id`.

## PII

- `booking_contact`: `name`, `email`, `phone`, marketing opt-in flags
- `visit`: `city`, `postal`, `age_at_visit`, `age_band`, `is_minor`, `referral_source`, `marketing_opt_in`, `group_type`

Not stored: DOB, signatures, waiver blobs, IP, street address, full postal/ZIP from Wherewolf, card data, last4, fingerprints, receipt URLs, refund reason text. Square `customer.id` stays unresolved in `source_identity` if ingested later; commerce tables have no `person_id`.

## Not in this migration

`person`, ingest jobs, dashboards. Square catalog and Square commerce **are** ingested manually (`import:` / `normalize:`), not by a scheduler.

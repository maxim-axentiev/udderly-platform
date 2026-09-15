# Operational schema (Phase 1)

PostgreSQL tables from migrations `apps/api/drizzle/0002_operational_core.sql` and `apps/api/drizzle/0003_booking_party_member_lifecycle.sql`. FareHarbor webhooks fill `integration_events` only. Operational booking tables stay empty until `npm run normalize:fareharbor`. Design: `docs/data-model.md`.

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

Plus existing `platform_meta` and `integration_events`.

## `source_identity`

Unique `(provider, entity_type, external_id)`.

`internal_entity_type` and `internal_entity_id` are **nullable together** (check `source_identity_internal_pair`). They are polymorphic: PostgreSQL does **not** foreign-key them to `booking` / `visit` / `experience`. Application code must keep them consistent when set.

Example unresolved: `square` / `customer` / `<id>` with both internal columns null.

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

## Foreign keys

All business FKs use **`ON DELETE RESTRICT`** so archiving/deleting an experience cannot silently drop bookings or visits.

`booking.rebooked_from_booking_id` / `rebooked_to_booking_id` reference `booking`.

`booking_party_member.source_identity_id` points at a stable FareHarbor `customer` `source_identity`. That identity stays **unresolved** (`internal_entity_type` / `internal_entity_id` null). There is no PERSON table yet. Party membership is the FK from `booking_party_member` to `source_identity`, not a resolution onto a person.

Removed participants keep their row: `is_active = false`, `removed_at` set, `last_seen_at` unchanged from the last payload that included them.

## No FareHarbor UUID on `booking`

Idempotency is `source_identity` (`fareharbor` / `booking` / uuid). Raw payloads stay in `integration_events`.

## PII

- `booking_contact`: `name`, `email`, `phone`, marketing opt-in flags
- `visit`: `city`, `postal`, `age_at_visit`, `age_band`, `is_minor`, `referral_source`, `marketing_opt_in`, `group_type`

Not stored: DOB, signatures, waiver blobs, IP, street address, card data, payment amounts.

## Not in this migration

`person`, `sale`, payments, products, ingest jobs.

# FareHarbor integration

Event ingestion. Raw webhooks are stored in `integration_events`. Inbox processing marks originals completed. Operational upserts (`session`, `booking`, `booking_contact`, `booking_party_member`, `source_identity`) are **manual** in this phase. PERSON, VISIT, SALE, and payments are not created. Canonical `experience` rows are not auto-created from FareHarbor item names.

## Why Booking with Payments

The production webhook uses FareHarbor’s full **Booking with Payments** schema, not Booking Optimized or Booking Optimized with Payments.

That schema is required for:

- booking UUID and PK
- booking status
- rebooking relationships
- availability PK, start/end, capacity, min/max party size, online booking status
- item PK/name
- customer contact
- customers and customer PKs
- customer types
- check-in status
- custom field values
- booking source
- affiliate company
- customer count
- financial totals
- payments
- refunds
- cancellation information

## Identity and lifecycle

- `booking.uuid` is the canonical booking identifier. Multiple webhooks with the same UUID refer to the same booking.
- Additional webhooks for one booking are expected after create, contact changes, check-in, modification, cancellation, rebooking, and other updates.
- `customers[].pk` identifies a FareHarbor customer for the life of that booking. It stays stable unless the booking is rebooked.
- Treat rebooking as the old booking being replaced and a new booking being created. Preserve `rebooked_from` and `rebooked_to`.
- Duplicate and nearly identical deliveries are normal. Receipt is stored every time. Downstream processing is idempotent: an identical payload is kept for audit and is not processed again as a new change.

## Security

FareHarbor does **not** send custom authorization headers or HMAC signatures for these webhooks. Do not invent `X-FareHarbor-Signature` checks.

FareHarbor recommends a hard-to-guess secret URL. This platform uses:

```
POST /webhooks/fareharbor/<FAREHARBOR_WEBHOOK_SECRET>
```

Set `FAREHARBOR_WEBHOOK_SECRET` in the root `.env` file. It is optional: the API starts without it, and the webhook then responds as unavailable (generic 404).

Never log this value. Never expose it from status endpoints.

Application logs redact `/webhooks/fareharbor/<secret>` to `/webhooks/fareharbor/[redacted]`. Traefik access logs on the Droplet are separate and may still contain the full path; do not paste those logs into tickets. See `docs/deployment.md`.

FareHarbor does **not** recommend IP allowlisting because source IPs may change. This receiver does not allowlist IPs.

## Acknowledgement

Return HTTP 200 after the raw event is durably stored in PostgreSQL. Keep the HTTP handler fast. Do not normalize inside the request. The queue worker acknowledges inbox processing only; it does not write operational booking tables.

If PostgreSQL cannot persist the event, do **not** return 200. FareHarbor should retry.

If PostgreSQL persist succeeds but Redis/BullMQ is temporarily unavailable, return HTTP 200 anyway. PostgreSQL is the durable source of truth. The event stays in a recoverable status (`received` until queued, or `failed` after a processor error). Do not mark it completed.

Re-enqueue recoverable events locally without waiting for FareHarbor:

```
npm run integrations:recover
```

That command finds `received`, `queued`, `processing`, and `failed` originals, enqueues them by internal event ID, skips duplicates/completed/in-flight jobs, and prints only counts. It does not print payloads or PII. There is no recurring scheduler yet.

Invalid secret: generic 404.  
Missing `booking.uuid`: HTTP 400.

Unknown extra fields are ignored. Additive FareHarbor schema changes must not break receipt.

## Architecture

```
FareHarbor POST
  -> secret URL
  -> integration_events row (JSONB payload)  [durable]
  -> BullMQ job { eventId }               [best-effort inbox complete]
  -> npm run integrations:recover         [if queueing failed]
  -> npm run map:fareharbor-experience     [manual item → experience]
  -> npm run normalize:fareharbor         [manual operational upsert]
```

Normalize a stored original, including `completed` inbox rows:

```
npm run normalize:fareharbor -- --event-id <integration-event-uuid>
npm run normalize:fareharbor -- --latest
```

`--latest` is the newest original (non-duplicate) FareHarbor booking event. Older events for the same booking UUID are skipped if a newer original exists. Missing `experience_source_mapping` for the FareHarbor item writes no operational rows and does not fail inbox processing.

Map a FareHarbor item to a canonical experience before normalizing. No SQL, no fuzzy name match:

```
npm run map:fareharbor-experience -- --item-id <fareharbor-item-pk> --name "Miniature Donkey Visits"
npm run map:fareharbor-experience -- --item-id <fareharbor-item-pk> --experience-id <canonical-experience-uuid>
```

`--name` creates a canonical experience only when no experience has that exact name. One exact name match is reused. Two or more exact matches stop for `--experience-id`. An item already mapped to a different experience is refused; remap is not implemented. `provider_object_type` is `item`. `--name` is the canonical experience name only; `external_label` stays null until a later normalize sees `booking.availability.item.name`. Item mappings are not copied into `source_identity`.

## Historical Booking Details CSV

Manual operational history from FareHarbor’s **Bookings** report (Booking details export). This does **not** call the External API and does **not** store the CSV.

The file is temporary local input only:

- Keep it outside the git repo, or in gitignored `imports/protected/`
- Restrict permissions (`chmod 600` on Unix)
- Delete the file after a successful validated import
- Never copy the CSV into PostgreSQL, `source_snapshot`, or `integration_events`
- Logs and CLI output must not print contact name, email, phone, booking notes, or cancellation notes

Production commands run compiled `apps/api/dist` JavaScript. Build first (`npm run build -w @udderly/api`). `:dev` variants use `tsx` for local source.

```
npm run map:fareharbor-report-item -- --item-label "Goat Recess" --name "Goat Recess"
npm run map:fareharbor-report-item -- --item-label "Goat Recess" --experience-id <uuid>
npm run classify:fareharbor-report-item -- --item-label "Gift Card" --non-experience
npm run import:fareharbor-report -- --file /path/to/report.csv --dry-run
npm run import:fareharbor-report -- --file /path/to/report.csv
```

Report `Item` labels are **not** FareHarbor item PKs. Experience mapping uses `provider=fareharbor`, `provider_object_type=report_item_label`, `external_id` = exact CSV label. That mapping is not copied into `source_identity`.

Non-experience labels (gift cards, adopt packages, and similar) are stored in `source_object_classification` as `non_experience`. They are not hardcoded in the importer. Unknown labels are skipped with no partial writes for that row.

Booking identity from the report is `fareharbor` / `booking_pk` / digits from `#123456789`. A later Booking-with-Payments webhook that carries the same `booking.pk` plus `booking.uuid` must reuse that canonical booking and attach `fareharbor` / `booking` / `<uuid>`. The reverse (uuid already resolved, pk new) attaches `booking_pk`. If uuid and pk resolve to different bookings, normalize reports `identity_conflict` and does not merge.

Sessions are created from report `Availability` (`YYYY-MM-DD @ hh:mmam/pm`) in `America/Toronto`. `end_at`, `capacity`, and `status` stay null. Idempotency uses a **report-derived** identity `fareharbor` / `availability_report_key` / `<experienceId>:<startAt ISO>`. That is not a FareHarbor availability PK. A later webhook `availability.pk` attaches to the existing historical session when the booking already points at it and start/experience evidence matches; conflicts are reported rather than merged.

The importer writes `booking`, `booking_contact`, `session`, and `source_identity` only. It does **not** create `booking_party_member` from `# of Pax`, PERSON, visit, sale, payment, or refund. Notes and money columns are ignored.

`Last Booked By` is categorized as `online` when it is exactly `Online`; any other value becomes `internal`. Staff names are not stored on `booking`.

Dry-run parses and validates the whole file, reads mappings/classifications, writes nothing, and prints safe counts plus unknown Item labels.

Synthetic tests (fake data only):

```
npm run test:fareharbor-report
```

Payloads are treated as sensitive. They are not logged and are not returned from HTTP APIs.

The same inbox can later store FareHarbor **Item** webhooks (`item.pk`, `item.name`, `company`, `external_api_url`, `dashboard_url`). Item processing is not implemented yet.

Crew Maker is out of scope.

## External API and history

This phase does **not** call the FareHarbor External API. Historical operational bookings can be imported from a Booking details CSV (see above) and later reconciled with webhook `booking.uuid` / `booking.pk` / `availability.pk`.

## Local environment

```
FAREHARBOR_WEBHOOK_SECRET=
```

Use a long random path-safe value.

Safe status:

```
GET /integrations/fareharbor/status
```

Synthetic local test (fake data only):

```
npm run test:fareharbor-webhook
```

Re-enqueue persisted events that never completed:

```
npm run integrations:recover
```

Manually normalize a stored FareHarbor booking event:

```
npm run normalize:fareharbor -- --event-id <uuid>
npm run normalize:fareharbor -- --latest
```

Map a FareHarbor item to a canonical experience:

```
npm run map:fareharbor-experience -- --item-id <pk> --name "Miniature Donkey Visits"
npm run map:fareharbor-experience -- --item-id <pk> --experience-id <uuid>
```

Those npm scripts run compiled `apps/api/dist` JavaScript (`node`, not `tsx`). Build the API first (`npm run build -w @udderly/api`). For unbuilt local source, use the `:dev` variants (`normalize:fareharbor:dev`, `map:fareharbor-experience:dev`, `import:fareharbor-report:dev`, `map:fareharbor-report-item:dev`, `classify:fareharbor-report-item:dev`, `integrations:recover:dev`).

## Next step before real FareHarbor delivery

1. Put a long random secret in production `.env`.
2. Apply database migrations.
3. Run the API with PostgreSQL and Redis.
4. Expose HTTPS (not HTTP) to FareHarbor.
5. In FareHarbor, set the webhook URL to `https://<host>/webhooks/fareharbor/<secret>` and choose **Booking with Payments**.

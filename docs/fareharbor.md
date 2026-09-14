# FareHarbor integration

Event ingestion only. Raw webhooks are stored and queued. They are not normalized into PERSON, BOOKING, PARTICIPANT, or TRANSACTION records yet.

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

FareHarbor does **not** recommend IP allowlisting because source IPs may change. This receiver does not allowlist IPs.

## Acknowledgement

Return HTTP 200 after the raw event is durably stored in PostgreSQL. Keep the HTTP handler fast. Do not normalize inside the request.

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
  -> BullMQ job { eventId }               [best-effort]
  -> processor updates processing status
  -> npm run integrations:recover         [if queueing failed]
```

Payloads are treated as sensitive. They are not logged and are not returned from HTTP APIs.

The same inbox can later store FareHarbor **Item** webhooks (`item.pk`, `item.name`, `company`, `external_api_url`, `dashboard_url`). Item processing is not implemented yet.

Crew Maker is out of scope.

## External API and history

This phase does **not** call the FareHarbor External API. Historical data is expected later from reports/exports, then reconciled against webhook identity (`booking.uuid`, later change events, payments/refunds).

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

## Next step before real FareHarbor delivery

1. Put a long random secret in production `.env`.
2. Apply database migrations.
3. Run the API with PostgreSQL and Redis.
4. Expose HTTPS (not HTTP) to FareHarbor.
5. In FareHarbor, set the webhook URL to `https://<host>/webhooks/fareharbor/<secret>` and choose **Booking with Payments**.

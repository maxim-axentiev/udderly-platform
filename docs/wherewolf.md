# Wherewolf integration

Read-only connection and schema audit only. Guest PII is not imported, stored, or exposed by HTTP.

## Environment variables

Set these in the repository root `.env` file. They are optional: the API starts without them.

```
WHEREWOLF_API_KEY=
WHEREWOLF_APP_ID=
```

`WHEREWOLF_APP_ID` is the Dashboard App ID. Wherewolf’s API calls this value `pool`, and that is how it is sent.

Official API base URL: `https://api.wherewolf.co.nz`

Requests are HTTP POST with JSON bodies. The API key is sent as `key` in the JSON body, not in logs.

## Connection status

With the API running:

```
http://localhost:3001/integrations/wherewolf/status
```

Example when configured and reachable:

```json
{
  "provider": "wherewolf",
  "configured": true,
  "connected": true
}
```

If the variables are missing, `configured` is `false` and `connected` is `false`. The response never includes credentials or guest data.

## Audit command

From the repository root:

```
npm run audit:wherewolf
```

This asks Wherewolf for the last 30 days of:

- bookings via `POST /reservations/get`
- guests via `POST /guest/getByFilter` with `selection: "cropped"`

Cropped guest records are used on purpose. Do not switch this to `full`. Full records can include signatures, photos, and signed terms.

### What the audit prints

- whether credentials are configured
- whether the API responded
- record counts
- field names, nested paths, and value types
- how often each field is populated

### What the audit does not print

- names, emails, phone numbers, dates of birth, addresses
- waiver text, signatures, photos
- raw guest or booking objects
- API key or App ID values

No audit files are written. Do not save raw Wherewolf responses into the repo.

## Manual import (sanitized snapshots)

Pulls a small date window, sanitizes cropped guests and reservations, then writes `source_snapshot` only. Does not create visits.

```
npm run import:wherewolf -- --date 2026-09-15
npm run import:wherewolf -- --from 2026-09-15 --to 2026-09-16
```

`--date` / `--from` / `--to` are **America/Toronto farm calendar dates**, not UTC dates. Internally the API window is stored/sent as timestamptz/UTC.

Inclusive/exclusive: `--date 2026-09-15` is the half-open UTC range from local midnight 2026-09-15 through local midnight 2026-09-16 (`dateBegin <= t < dateEnd`). `--from A --to B` includes both local calendar dates: from local midnight A through local midnight of the day after B.

`source_snapshot.observed_at` is when Goat Barn imported the record. It is not the visit date.

Production scripts use compiled `apps/api/dist`. Local unbuilt source: `import:wherewolf:dev`.

Do not persist DOB, signatures, IP, street address, full postal/ZIP, guardian identity, medical data, or raw unrestricted payloads. CLI output is counts only.

## Safe inspection (before bulk normalize)

```
npm run inspect:wherewolf -- --date 2026-09-15
```

Reports aggregate counts for that farm date only (status, lastVisit/tripTimeslot presence, signed true/false/absent, mapped vs unmapped activity, reservation ids, visit-occurrence identity). No names, emails, phones, guest ids, postal codes, IP, signatures, or raw JSON.

Attendance is **not** confirmed yet. Source `status` is preserved as unconfirmed. `signed=true` is not attendance.

## Experience mapping

Wherewolf activity ids are the stable mapping key (`provider=wherewolf`, `provider_object_type=activity`, `external_id` as text). Guest snapshots may have only `activities: ["532251"]`. Reservation snapshots may also have `activitiesAsObjects`. Both shapes resolve the same mapping. Names are never guessed.

```
npm run map:wherewolf-experience -- --activity-id <id> --name "Farm Glamping"
npm run map:wherewolf-experience -- --activity-id <id> --experience-id <canonical-uuid>
```

`--name` is canonical Udderly naming. Map a Wherewolf activity onto an existing FareHarbor-backed experience with `--experience-id` so Farm Glamping is not duplicated. No fuzzy match. Conflicting remaps are refused.

## Manual visit normalization

```
npm run normalize:wherewolf -- --snapshot-id <uuid>
npm run normalize:wherewolf -- --date 2026-09-15
```

Requires an explicit activity mapping and a deterministic visit-occurrence identity:

- `wherewolf` / `guest_visit` / `{guestId}:r:{reservationsID}` when `reservationsID` exists
- otherwise `{guestId}:t:{occurrenceInstant}` from `lastVisit`, `tripTimeslot`, or reservation start/date fields
- if only `guest.id` is available, normalization is skipped (`insufficient visit occurrence identity`)

`--date` selects snapshots by that occurrence instant on the America/Toronto farm date, never by `observed_at`. Snapshots with no visit/occurrence timing are skipped and counted.

Creates/updates `visit` and `source_identity`. Does not create PERSON. Booking/session links only from explicit FareHarbor ids on aliases/`bookingLabel`/`displayId`. Source `status` is copied and treated as unconfirmed attendance. `signed=true` is not attendance.


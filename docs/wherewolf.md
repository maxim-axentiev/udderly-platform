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

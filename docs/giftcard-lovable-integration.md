# Gift-card website and Lovable integration

This document describes the customer-facing gift-card site in `apps/web`, the NestJS routes it calls, and a safe way to redesign that site in a new Lovable project. It is a source reference for the redesign. It does not change production behavior.

Production host: `https://giftcard.udderlyridiculousfarmlife.com`

The API process also serves Goat Barn at `https://goatbarn.udderlyridiculousfarmlife.com`. Inventory and photograph rules are enforced by the API on both hostnames. The customer pages exist only on the gift-card hostname.

## Current frontend

`apps/web` is a React 19 application built with Vite 7 and TanStack Start / TanStack Router. Styling is Tailwind CSS 4, loaded from `apps/web/src/styles.css` with `@import "tailwindcss"`. There is no component library. Shared layout is a few small components:

| Piece | Role |
| --- | --- |
| `src/routes/*.tsx` | File routes. TanStack generates `src/routeTree.gen.ts`. |
| `src/naming/shell.tsx` | Header, footer, and print-hidden chrome for customer pages. |
| `src/naming/object-photo.tsx` | Photograph or an empty state. Rejects unsafe URLs. |
| `src/naming/certificate.tsx` | Printable certificate after a name is submitted. |
| `src/naming/api.ts` | Customer HTTP client and response parsers. |
| `src/naming/checkout.ts` | Stores the FareHarbor URL in `sessionStorage` for the tab that reserved. |
| `src/naming/format.ts` | Price, availability labels, checkout-URL allow-list, photograph allow-list. |
| `src/naming/preview.ts` | Server function that reads `NAMING_PREVIEW_MODE`. |
| `src/naming/inventory.ts` | Staff HTTP client. Uses same-origin paths, not `apiBaseUrl()`. |
| `server.mjs` | Production Node server. Serves the built client and the TanStack server bundle on port 3000. |

The production image sets `VITE_API_URL` empty at build time. `apiBaseUrl()` then returns `""`, so customer fetches are same-origin (`/naming/...`). In local development, an empty `VITE_API_URL` falls back to `http://localhost:3001`. The Vite dev server proxies `/inventory/` and `/photos/` to that API. It does not proxy `/naming`.

`NAMING_PREVIEW_MODE` is read on the server at request time by `loadCampaignPreview`. It is not a `VITE_` variable, so changing it does not require a frontend rebuild. The production website container sets it from the Compose environment.

### Pages

| URL | File | Purpose |
| --- | --- | --- |
| `/` | `routes/index.tsx` | Catalog, price filter, and Buy & Name. |
| `/reservation/$id` | `routes/reservation.$id.tsx` | Payment status for one reservation. |
| `/name/$token` | `routes/name.$token.tsx` | Emailed naming link and certificate. |
| `/inventory` | `routes/inventory.tsx` | Staff inventory. The page path has no trailing slash. |
| `/health` | `routes/health.tsx` | Frontend status page. |

Unknown paths render the root “Not found” view.

### Homepage

The loader calls `loadCampaignPreview()`.

When `NAMING_PREVIEW_MODE` is exactly `true`, the page shows three built-in sample objects and does not call the API. Their ids are `preview-wheelbarrow`, `preview-poop-vacuum`, and `preview-tractor`. Prices are 10000, 35000, and 50000 CAD cents. Photographs are null, so the card says “Photo coming soon”. Each card is marked Sample. Buy & Name is rendered disabled.

When preview mode is off, the browser calls `GET /naming/objects` and renders that list. A 404 becomes “This campaign is not available right now.” An empty list says “No objects are published yet.”

Prices are integer cents. `formatPrice` uses `Intl.NumberFormat("en-CA", { style: "currency" })`, so 2000 CAD cents displays as `$20.00`. The price filter lists the distinct cent values present in the loaded catalog.

`availability` comes from the object status:

| API value | Label | Buy & Name |
| --- | --- | --- |
| `available` | Available | Shown when preview mode is off. |
| `held` | On hold | Hidden. |
| `claimed` | Claimed | Hidden. |

The public catalog does not include a `published` field. Unpublished objects are omitted by the API. Published objects can still be held or claimed, and those cards stay visible without a buy button.

Photographs use `ObjectPhoto`. A stored path is shown only when it matches `/photos/{uuid}.jpg|png|webp`. An `http:` or `https:` URL is also allowed. Any other string, including `..` and SVG paths, is dropped and the empty state is shown. A failed image load also shows the empty state.

### Reservation and FareHarbor

Buy & Name runs only outside preview mode, and only for `available` objects.

1. The click opens a blank popup immediately, before the network call, so the browser still treats it as a user gesture.
2. The page `POST`s `/naming/reservations` with `{ "objectId" }`.
3. The response includes `reservationId`, `holdExpiresAt`, and `checkoutUrl`.
4. The checkout URL is accepted only when it matches this exact pattern:

   `https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/{itemId}/?full-items=yes&flow={flowId}&ref={ref}`

   `{ref}` is 1 to 128 characters from `A-Za-z0-9_-`. The API generates a 16-byte base64url reference. The browser does not create the reference. Until FareHarbor confirms separate items, `{itemId}` is `308290` and `{flowId}` is `573099` for every tier. A configured tier pair is accepted only as that exact item and flow together. Extra parameters, a different host, or a reordered query are rejected. An empty allow-list does not open checkout.
5. A matching URL is saved in `sessionStorage` under `naming-checkout:{reservationId}` and the popup navigates there with `location.replace`. `popup.opener` is set to `null`. A non-matching URL closes the popup and is not stored.
6. The current tab navigates to `/reservation/{reservationId}`.

The API holds the object for 30 minutes (`NAMING_HOLD_MS`). Returning from FareHarbor does not mean the gift card was paid. The reservation page says that explicitly.

### Payment-status page

`/reservation/{reservationId}` loads `GET /naming/reservations/{reservationId}`.

While the status is `awaiting_payment`, the page polls that endpoint every 8 seconds and also offers “Check payment status”. If this tab stored a checkout URL, it shows “Continue to FareHarbor checkout”. Another tab does not have that `sessionStorage` entry and instead says the link is kept in the tab that created the reservation.

| `status` | Meaning on the page |
| --- | --- |
| `awaiting_payment` | Hold is still active. Includes `holdExpiresAt`. |
| `expired` | Hold ended or the reservation was released. |
| `paid` | Payment was recorded. The naming link arrives by email, not on this page. |
| `named` | Includes `submittedName`. |
| `review` | Payment needs review. This page cannot submit a name. |

The page does not show the checkout reference, the FareHarbor booking id, the paid amount, or the purchaser email.

### Naming link and certificate

The email contains `https://giftcard.udderlyridiculousfarmlife.com/name/{token}`. The token is 43 characters from `A-Za-z0-9_-` (32 random bytes, base64url). The database stores only the SHA-256 hex hash. The plaintext token exists in the email and in that URL.

`GET /naming/links/{token}` returns the object name, description, photograph, `namingStatus` (`awaiting_name` or `named`), and `submittedName`. It does not return the price, reservation id, purchaser, or a certificate number.

The form asks for a name, then a confirmation step, then `POST`s `{ "name" }`. The input `maxLength` is 80. The API trims the name, rejects an empty name, rejects more than 80 Unicode code points, and rejects `<`, `>`, and control or line-separator characters. A successful response is `{ "submittedName" }`. The page then renders `NamingCertificate` and a print button. Print CSS hides the header, footer, form chrome, and navigation through `.print-hidden`.

A 409 with the message “This item already has a name.” reloads the link so the certificate can appear.

### Preview mode

Preview mode is a website feature. It does not enable purchasing and it does not turn on the naming API.

| `NAMING_CAMPAIGN_ENABLED` | `NAMING_PREVIEW_MODE` | Customer site |
| --- | --- | --- |
| `false` | `true` | Sample catalog, buying disabled. Current production state. |
| `false` | `false` | Homepage calls the API and receives 404, shown as the campaign being unavailable. |
| `true` | `false` | Live catalog and Buy & Name. |
| `true` | `true` | Samples still replace the live catalog, because the loader never fetches when preview is on. |

### Staff inventory

`/inventory` is a staff page on the same website. On load it calls `GET /inventory/session` with credentials. A valid cookie returns a fresh CSRF token and the original expiry. Otherwise the password form is shown. The CSRF token stays in React state. It is not written to `localStorage` or `sessionStorage`.

After sign-in the page lists objects and can add an unpublished object, edit name, description, and price, upload a JPEG, PNG, or WebP up to 3 MB, and publish or unpublish. Held and claimed objects do not send a price change. Staff photographs are requested from `/inventory/photos/...` so the session cookie is included. The database still stores `/photos/...`.

Logout is `POST /inventory/session/logout` with the CSRF header. That deletes the server session id.

## API contract

Customer and staff calls expect JSON. Nest error bodies look like:

```json
{
  "message": "This object is not available.",
  "error": "Conflict",
  "statusCode": 409
}
```

`message` may be a string. The customer client also accepts an array of strings. A `NotFoundException` with no custom message uses `"Not Found"`.

Public naming routes return 404 for every method when `NAMING_CAMPAIGN_ENABLED` is not true. Inventory routes do not use that flag. They return 404 when `NAMING_ADMIN_PASSWORD` and `NAMING_ADMIN_SESSION_SECRET` are not both configured. Setting only one of those variables prevents the API from starting.

### Customer routes

These routes require no staff cookie. On the gift-card hostname, Traefik also applies the campaign Basic Auth middleware to `PathPrefix(/naming)`. Goat Barn does not use that middleware, but the same campaign flag and handlers apply.

Rate limits for `POST /naming/reservations` and `POST /naming/links/:token` are separate: 5 requests per 10 minutes per client IP, counted in the API process. Excess requests return 429 with message “Too many requests. Try again later.”

#### `GET /naming/objects`

Auth: campaign must be enabled. No body.

```json
{
  "objects": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "North Gate",
      "description": "The gate by the lane.",
      "photoUrl": "/photos/11111111-1111-4111-8111-111111111111.jpg",
      "priceCents": 2000,
      "currency": "CAD",
      "availability": "available"
    }
  ]
}
```

`photoUrl` may be `null`. `availability` is `available`, `held`, or `claimed`. Objects are ordered by name. Only rows with `published_at` set are included. Response cache is `no-store`.

| Status | When |
| --- | --- |
| 200 | Campaign is enabled. |
| 404 | Campaign is disabled. |

#### `POST /naming/reservations`

```json
{ "objectId": "11111111-1111-4111-8111-111111111111" }
```

The body is a strict object. Extra keys are rejected. `objectId` must be a UUID.

```json
{
  "reservationId": "22222222-2222-4222-8222-222222222222",
  "holdExpiresAt": "2026-11-04T16:00:00.000Z",
  "checkoutUrl": "https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/308290/?full-items=yes&flow=573099&ref=exampleRef"
}
```

The checkout URL is built on the server:

`https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/{itemId}/?full-items=yes&flow={flowId}&ref={checkoutRef}`

The item and flow come from the reservation's snapshotted price. `NAMING_FAREHARBOR_TIERS` maps `10000`, `25000`, `50000`, and `100000` cents to a FareHarbor item id and flow id. Leave it unset until those ids are confirmed. Unset uses item `308290` and flow `573099` for all four tiers. A published object whose price is not one of those tiers cannot be reserved. The `ref` value is stored on the reservation and is how a later FareHarbor webhook is matched. The browser must open the returned URL unchanged.

| Status | Message | When |
| --- | --- | --- |
| 201 | | Hold created. |
| 400 | Enter a valid object. | Body is not a strict `{ objectId: uuid }`. |
| 404 | Not Found | Unknown id, unpublished object, or campaign disabled. |
| 409 | This object is not available. | Not `available`, already held, or already claimed. |
| 409 | This object cannot be purchased right now. | The snapshotted price has no configured FareHarbor item. No hold is created. |
| 429 | Too many requests. Try again later. | Reserve rate limit. |

Creating a reservation inserts a `held` reservation and sets the object to `held`. A delayed job releases that hold after 30 minutes if it is still the current hold. Release does not cancel an open FareHarbor checkout and does not claim the object. A late payment can still be matched without taking a newer hold.

#### `GET /naming/reservations/:reservationId`

`:reservationId` must be a UUID. Otherwise the response is 404.

The object block is the same public object fields without `availability`. Status-specific fields:

```json
{
  "reservationId": "22222222-2222-4222-8222-222222222222",
  "status": "awaiting_payment",
  "holdExpiresAt": "2026-11-04T16:00:00.000Z",
  "object": {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "North Gate",
    "description": "The gate by the lane.",
    "photoUrl": null,
    "priceCents": 2000,
    "currency": "CAD"
  }
}
```

| Stored reservation | Response `status` | Extra fields |
| --- | --- | --- |
| `held` and `holdExpiresAt` is still in the future | `awaiting_payment` | `holdExpiresAt` |
| `held` and the hold time has passed | `expired` | |
| `released` | `expired` | |
| `claimed` without a submitted name | `paid` | |
| `claimed` with `submittedName` and `namedAt` | `named` | `submittedName` |
| Any other stored status, including review | `review` | |

`paid` does not include the naming token. The token is emailed after the payment match.

| Status | When |
| --- | --- |
| 200 | Reservation exists and the campaign is enabled. |
| 404 | Missing reservation, bad id, or campaign disabled. |

#### `GET /naming/links/:token`

The token must match `^[A-Za-z0-9_-]{43}$`. Any other token is 404. An unknown hash, or a reservation that is not `claimed`, is also 404. The two cases look the same.

```json
{
  "objectName": "North Gate",
  "description": "The gate by the lane.",
  "photoUrl": "/photos/11111111-1111-4111-8111-111111111111.jpg",
  "namingStatus": "awaiting_name",
  "submittedName": null
}
```

`namingStatus` is `named` when `namedAt` is set. `photoUrl` may be `null`.

#### `POST /naming/links/:token`

```json
{ "name": "Clover" }
```

Strict object. `name` is a string of at most 200 characters before normalization. Normalization trims it and enforces the 80-character and character rules above.

```json
{ "submittedName": "Clover" }
```

| Status | Message | When |
| --- | --- | --- |
| 200 | | Name stored. |
| 400 | Enter a name. | Body failed the schema. |
| 400 | Enter a name using letters, numbers, and simple punctuation. | Empty, too long, or unsafe characters. |
| 404 | Not Found | Bad token, unknown link, reservation not claimed, or campaign disabled. |
| 409 | This item already has a name. | A name was already stored. |
| 409 | This naming link cannot accept a name. | Payment was reversed. |
| 429 | Too many requests. Try again later. | Submit rate limit. |

### Payment matching

The browser never calls the FareHarbor webhook or the payment matcher. Those run inside the API after FareHarbor notifies Goat Barn. The redesigned site must not add its own payment confirmation.

A payable webhook is matched on the checkout `ref` and the FareHarbor item configured for that reservation's snapshotted price. Another campaign item, including the confirmed item `308290` after a tier has moved to a different id, does not claim, underpay, refund, or email. A payment at least the snapshotted price can claim the object and queue the naming email. A smaller payment releases the hold and does not queue the naming email. A duplicate of the same booking does not create a second claim. A refund of the matched item still marks the payment reversed. The payment time still comes from `payment.created_at`. The customer sees that as `review`, `paid`, or `named` on the reservation URL. The naming page is a different URL and appears only after the email is sent.

The email is plain text. The subject is `Naming rights for {objectName}`. The body contains the one private `/name/{token}` URL. FareHarbor sends the gift card itself in a separate message.

### Photographs

| Request | Who | Result |
| --- | --- | --- |
| `GET /photos/{uuid}.jpg\|png\|webp` | Anyone | 200 only when that object is published and `photoUrl` is exactly that path. Otherwise 404. |
| `GET /inventory/photos/{uuid}.jpg\|png\|webp` | Staff session cookie | 200 when `photoUrl` matches, including unpublished objects. |
| `GET /photos/` or any other filename | Anyone | 404. There is no directory listing. |

Public responses send `Cache-Control: no-cache` and `X-Content-Type-Options: nosniff`. Staff responses send `Cache-Control: private, no-store`. Traefik serves `/photos/` and `/inventory/` without campaign Basic Auth, so a published photograph still loads after Basic Auth is removed from the site.

Customer pages should keep using the stored `/photos/...` value. Staff pages should map that value to `/inventory/photos/...`.

### Staff routes

Cookie name: `naming_inventory`. Flags: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/inventory`. Lifetime: 12 hours from sign-in. Restore does not extend that expiry. The cookie is sent to `/inventory` and `/inventory/...`, and is not sent to `/naming` or `/photos`.

Login does not require a CSRF token. Every other non-GET inventory request requires header `X-CSRF-Token` matching the active session. A missing or wrong token returns 403, “Refresh this page and sign in again.” A missing, expired, logged-out, or superseded cookie returns 401, “Sign in to manage inventory.”

Login failures are limited to 5 per 10 minutes per IP. A correct password during that lockout still returns 429.

| Method and path | CSRF | Success |
| --- | --- | --- |
| `POST /inventory/session` | No | 200 `{ "csrfToken", "expiresAt" }` and `Set-Cookie`. Body `{ "password" }`, 1 to 200 characters. |
| `GET /inventory/session` | No | 200 with a new `csrfToken` and the original `expiresAt`. |
| `POST /inventory/session/logout` | Yes | 204 and a cleared cookie. |
| `GET /inventory/objects` | No | 200 `{ "objects": [InventoryObject] }`. |
| `POST /inventory/objects` | Yes | 201. Creates unpublished, with `photoUrl: null`. |
| `PATCH /inventory/objects/:id` | Yes | 200. |
| `POST /inventory/objects/:id/photo` | Yes | Raw body, not multipart. JPEG, PNG, or WebP by signature, at most 3 MB. |
| `GET /inventory/photos/:file` | No | Image bytes when the session is valid. |

`InventoryObject` fields are only:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "North Gate",
  "description": "The gate by the lane.",
  "photoUrl": null,
  "priceCents": 2000,
  "currency": "CAD",
  "availability": "available",
  "published": false
}
```

Create body: `{ "name", "description", "priceCents" }`. Name is 1 to 120 trimmed characters. Description is at most 2000. `priceCents` is an integer from 0 through 10000000. `publish` is not accepted on create.

Patch body accepts any combination of `name`, `description`, `priceCents`, and `published`. Publishing is allowed only while `availability` is `available`. Unpublishing is always allowed. A price change on a held or claimed object returns 409, “The price cannot change while this object is held or claimed.”

Wrong password: 401, “That password was not accepted.” Staff responses must not include the password, the session secret, reservation ids, checkout references, or naming tokens.

### Health

These are API routes, not the website `/health` page.

| Method and path | Response |
| --- | --- |
| `GET /health` | `{ "status": "ok" }` |
| `GET /health/ready` | `{ "status": "ok" \| "degraded", "checks": { "postgres": { "status": "up" \| "down" }, "redis": { "status": "up" \| "down" } } }` |

On the gift-card hostname, `/health` is served by the website page because only `/naming`, `/inventory/`, and `/photos/` are routed to the API. Goat Barn serves the API health routes directly.

## What the redesign must preserve

The visual design can change. These behaviors are part of the working production system.

**Same-origin customer API.** Production fetches `/naming/...` on the gift-card host. Traefik sends that prefix to the API. `WEB_ORIGIN` is the Goat Barn origin and is not a substitute for hosting the gift-card UI on another domain.

**Basic Auth while the site is private.** The website router and the `/naming` router use the existing campaign Basic Auth middleware. `/inventory` without a trailing slash stays on the website, so staff still pass that prompt before the staff password. `/inventory/` and `/photos/` intentionally do not use that middleware.

**Traefik path split.**

| Request | Router |
| --- | --- |
| `giftcard` host, path `/inventory` | Website, priority 1, Basic Auth. |
| `giftcard` host, path starting with `/inventory/` | API, priority 100, no Basic Auth. |
| `giftcard` host, path starting with `/photos/` | API, priority 100, no Basic Auth. |
| `giftcard` host, path starting with `/naming` | API, priority 100, Basic Auth. |
| Any other `giftcard` path | Website, Basic Auth. |
| `goatbarn` host | API, no Basic Auth. |

`PathPrefix(/inventory/)` does not match the page `/inventory`. A redirect from `/inventory` to `/inventory/` would send the HTML request to the API. The redesigned site must keep the page URL without that redirect.

**Reservation rules.** One active hold per object, 30 minutes, unique checkout reference, and no claim until the webhook match. The UI must not mark a visitor as paid because FareHarbor closed or the browser came back.

**Checkout URL allow-list.** Only the returned FareHarbor gift-card embed URL may be opened or stored.

**Naming-link security.** The token is the secret. Pages must not log it, put it in analytics, or build a shorter public id. The certificate is rendered from the link response. It has no certificate number, purchaser, or payment amount because the API does not provide them.

**Staff session.** `HttpOnly` cookie, path `/inventory`, CSRF header on writes, CSRF kept in memory, logout that invalidates the server session. Image tags for unpublished photographs must use `/inventory/photos/...`.

**Public photographs.** Published images load from `/photos/...` without a staff cookie and without Basic Auth.

### Replacing `apps/web` with an untouched Lovable app

A fresh Lovable export would drop the behavior above even if the screens looked similar.

- A Lovable-hosted preview on another origin cannot send the inventory cookie and cannot rely on Traefik’s same-origin `/naming` routes. The API CORS setting is not the gift-card site.
- `NAMING_PREVIEW_MODE` is a runtime server variable. A static export baked in Lovable cannot switch preview mode the way the current container does.
- Generated clients often invent REST resources, Supabase tables, or a checkout session. None of those exist here. The contract is the five customer routes and the inventory routes listed above.
- The popup has to open on the click, before `await`. Opening it after the fetch is blocked by browsers.
- `sessionStorage` for the checkout URL is per tab. Moving it to `localStorage` would expose the FareHarbor URL to every page on the origin, including a future script on `/`.
- Route paths `/reservation/{uuid}` and `/name/{43-character-token}` are already in emails and in the browser history of the completed production test. Renaming them breaks those links.
- The inventory page and the API prefix must remain distinct. A catch-all `/inventory/*` page route on the website would steal `/inventory/session` from the API if Traefik priority were also changed.
- Print CSS and the certificate’s limited fields are part of the delivered naming flow.
- Dev proxy coverage is only `/inventory/` and `/photos/`. Customer calls in production do not use that proxy.

## Lovable workflow

The farm’s marketing site can stay in its current Lovable project. The gift-card experience should be a second Lovable project. It should reuse the farm project’s visual language and must not reuse a backend, database, or payment account from that project.

1. **Create the gift-card project empty.** Do not enable Lovable Cloud, Supabase, authentication, or payments. Do not connect it to FareHarbor.
2. **Bring branding across as design reference.** Copy the farm project’s colors, type, logo, and a few screenshots into the gift-card project brief. Use Lovable’s design-reference or screenshot flow if the product offers it. Keep the projects separate so a gift-card prompt cannot edit the marketing site, and a marketing prompt cannot edit checkout behavior.
3. **Design against placeholder objects.** Use fictional names and prices. Label them as samples. Leave Buy & Name visible but inactive in the prototype, or point it at a static “this is a design preview” state. Do not call production `/naming/reservations`. Do not use the real 43-character naming token from the completed test.
4. **Design the real screens, not a new information architecture.** The prototype needs the catalog, reservation status, naming form, confirmation, certificate, and print view. Staff inventory can stay on the current `/inventory` page for the first redesign. If Lovable also draws inventory, treat those frames as visual only until they are wired to the staff contract.
5. **Export the frontend.** Use Lovable’s GitHub export or a downloaded source archive. Reject any generated Supabase client, SQL, edge functions, or payment SDK before merging.
6. **Integrate in this repository.** Keep `apps/web` as the deployed app. Move layout and styling into the existing route components, or add presentational components those routes render. Keep `api.ts`, `checkout.ts`, the checkout-URL and photograph allow-lists, the preview server function, the inventory client, and the route paths. Connect buttons to the existing functions instead of generating a new client.
7. **Deploy the website container only** when the redesigned `apps/web` build passes. Leave the API image, PostgreSQL, Redis, and Traefik running unless an API change was separately reviewed. Keep `VITE_API_URL` empty. Keep `NAMING_CAMPAIGN_ENABLED=false` until a launch decision. Keep `NAMING_PREVIEW_MODE=true` until the redesigned site is ready to show real published objects.

Placeholder copy in Lovable is safe. The production API remains the source of objects, holds, payments, emails, and certificates after the code returns to this repository.

## Compatibility notes

| Topic | What to do |
| --- | --- |
| Lovable’s default Vite SPA | The production server is TanStack Start plus `server.mjs`. Either adapt the export to the file routes, or keep the Start shell and use the export as components. A second static host would bypass Traefik. |
| Tailwind version | This app uses Tailwind 4. A Tailwind 3 export needs its class names checked before the production build. |
| Fonts and images | Host branding assets in `apps/web` and serve them from the website container. Do not point photographs at a new storage bucket. Object photographs stay on `/photos` and `/inventory/photos`. |
| Environment variables | The redesign may read `NAMING_PREVIEW_MODE` on the server. Do not add a public `VITE_` flag that turns on purchasing. |
| Sample ids | `preview-*` ids are not UUIDs. The reserve endpoint will reject them. The live catalog must come from `GET /naming/objects` when preview mode is off. |
| Popup blockers | Keep the blank `window.open` in the click handler. |
| Basic Auth and fetch | Same-origin `/naming` requests from a page that already passed Basic Auth include those credentials. A cross-origin Lovable preview will not. |
| Inventory CSRF | Returning the token from `GET /inventory/session` is intentional. Do not store it in `localStorage`. |
| Certificate data | Do not add purchaser, amount, or date fields unless the API starts returning them. |
| Goat Barn | Do not mount the gift-card UI on the Goat Barn hostname. That host is the operations API. |

## Deployment checklist

Use this when the redesigned frontend is ready to ship. It is not a launch of purchasing.

- [ ] Customer pages still call only the documented `/naming` routes, with the documented JSON.
- [ ] Buy & Name still validates `checkoutUrl` before opening it, and still stores it in `sessionStorage`.
- [ ] `/reservation/{id}` still polls `awaiting_payment` and does not treat a checkout return as payment.
- [ ] `/name/{token}` still loads and submits through `/naming/links/{token}`.
- [ ] The certificate still prints, and the token is not copied into a new public identifier.
- [ ] `/inventory` remains the website page and `/inventory/` remains the API prefix.
- [ ] Staff sign-in, refresh, logout, CSRF, and unpublished photograph preview still work.
- [ ] Public `/photos/{uuid}.ext` still renders for a published object and 404s when unpublished.
- [ ] `VITE_API_URL` is empty in the production web build.
- [ ] `NAMING_CAMPAIGN_ENABLED` stays `false` unless launch was explicitly requested.
- [ ] `NAMING_PREVIEW_MODE` is `true` for a private design check, and set `false` only when real published objects should appear.
- [ ] Campaign Basic Auth still protects the website and `/naming` until that protection is intentionally removed.
- [ ] Tests, typecheck, lint, and the web production build pass.
- [ ] Deploy recreates the website container only. PostgreSQL, Redis, and Traefik stay up.
- [ ] After deploy, unauthenticated gift-card HTML returns 401, the authenticated preview or catalog renders, `/naming/objects` matches the campaign flag, and Goat Barn `/health` and `/health/ready` stay healthy.
- [ ] No naming object, reservation, payment, or email is changed as part of the design deploy.

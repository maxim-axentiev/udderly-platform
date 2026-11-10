# FareHarbor tier checkout

Name That Thing! has four gift-card prices. Each price needs its own FareHarbor item before that item can be used at checkout. The confirmed item today is `308290`, flow `573099`. That pair stays the default for every tier until the new ids are set.

Do not invent item or flow ids. Do not turn purchasing on to try an unconfirmed id.

## Setting

`NAMING_FAREHARBOR_TIERS` is read by the API and by the website. Both containers must get the same value. Leave it empty until every id below is confirmed.

```text
10000:ITEM:FLOW,25000:ITEM:FLOW,50000:ITEM:FLOW,100000:ITEM:FLOW
```

| Cents | Price | Required from FareHarbor |
| --- | --- | --- |
| `10000` | $100 CAD | Item pk and booking flow id |
| `25000` | $250 CAD | Item pk and booking flow id |
| `50000` | $500 CAD | Item pk and booking flow id |
| `100000` | $1,000 CAD | Item pk and booking flow id |

The value must contain each of those four prices once. Item and flow ids are decimal numbers without leading zeros. Any other price, a duplicate, or a missing tier stops the API from starting. An empty value does not stop the API. It uses item `308290` and flow `573099` for all four prices.

The website reads the same variable when it decides whether a checkout URL may open. A bad value produces no allowed URLs, so checkout stays closed.

## What FareHarbor needs to confirm

For each of the four prices:

- The gift-card item pk.
- The booking flow id used by the embed.
- The embed still uses this shape, with our reservation reference in `ref`:

  `https://fareharbor.com/embeds/book/udderlyridiculousfarmlife/items/{itemPk}/?full-items=yes&flow={flowId}&ref={checkoutRef}`

- A webhook for that item includes `booking.availability.item.pk`, `booking.online_booking_references` equal to our `ref`, one card payment in `cad`, `amount_paid` in minor units, and `payments[0].created_at`.
- A refund is still `payments[0].refunds` with at least one entry.

The same flow id may be used for more than one item. The item pk may not be shared between prices once the separate items exist. Until then, repeating `308290` and `573099` for every price is the same as leaving the setting empty.

## What the application does

A reservation stores the object's price in cents. Checkout uses the item and flow mapped to that price, and puts the reservation's checkout reference in `ref`.

A later webhook can claim, underpay, or refund that reservation only when the FareHarbor item pk is the one mapped to the stored price. Paying the $100 item does not satisfy a $1,000 reservation. A payment below the stored price does not claim and does not queue the naming email. A payment at or above the stored price can claim. The same booking sent again is a duplicate. The payment time still has to be present and on or before December 31, 2026 at 11:59 p.m. Eastern Time.

An already claimed reservation whose price is not one of the four tiers, including the $20 test object, still matches only item `308290`.

A published object at any other price cannot be reserved. No hold is created.

## Activation

Set the confirmed value in the production environment for both the API and the website, then deploy that configuration in a later change. This document does not change the running server, publish inventory, enable purchasing, or start a FareHarbor payment.

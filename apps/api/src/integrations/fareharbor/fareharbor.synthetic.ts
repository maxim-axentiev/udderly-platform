export const SYNTHETIC_BOOKING_UUID =
  "00000000-0000-4000-a000-000000000001";

export function createSyntheticFareharborBookingPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    booking: {
      uuid: SYNTHETIC_BOOKING_UUID,
      pk: 900001,
      status: "booked",
      rebooked_from: null,
      rebooked_to: null,
      is_pre_sale: false,
      customer_count: 2,
      source: "online",
      note: "SYNTHETIC local test note — not real guest data",
      confirmation_url:
        "https://fareharbor.example.invalid/embeds/cart/synthetic/book/0001/",
      dashboard_url:
        "https://fareharbor.example.invalid/dashboard/bookings/900001/",
      affiliate_company: {
        pk: 800001,
        name: "SYNTHETIC Affiliate Co",
      },
      contact: {
        name: "SYNTHETIC Test Booker",
        email: "synthetic.booker@example.invalid",
        phone: "+10000000000",
      },
      availability: {
        pk: 700001,
        start_at: "2026-10-01T14:00:00-04:00",
        end_at: "2026-10-01T15:00:00-04:00",
        capacity: 12,
        minimum_party_size: 1,
        maximum_party_size: 12,
        online_booking_status: "available",
        item: {
          pk: 600001,
          name: "SYNTHETIC Goat Walk",
        },
      },
      customers: [
        {
          pk: 500001,
          checkin_status: "no-show",
          customer_type: {
            pk: 400001,
            singular: "Adult",
            plural: "Adults",
          },
          custom_field_values: [
            {
              pk: 300001,
              name: "SYNTHETIC How did you hear about us",
              value: "SYNTHETIC search",
            },
          ],
        },
        {
          pk: 500002,
          checkin_status: "no-show",
          customer_type: {
            pk: 400002,
            singular: "Child",
            plural: "Children",
          },
          custom_field_values: [],
        },
      ],
      receipt_subtotal: "80.00",
      receipt_taxes: "0.00",
      receipt_total: "80.00",
      amount_paid: "80.00",
      payments: [
        {
          pk: 200001,
          amount: "80.00",
          receipt: "SYNTHETIC-PAY-0001",
        },
      ],
      refunds: [],
      cancellation: null,
      ...overrides,
    },
  };
}

export function createChangedSyntheticFareharborBookingPayload(): Record<
  string,
  unknown
> {
  return createSyntheticFareharborBookingPayload({
    status: "cancelled",
    cancellation: {
      reason: "SYNTHETIC cancellation for webhook test",
      cancelled_at: "2026-09-14T18:00:00.000Z",
    },
    amount_paid: "0.00",
    refunds: [
      {
        pk: 200002,
        amount: "80.00",
        receipt: "SYNTHETIC-REF-0001",
      },
    ],
    rebooked_to: {
      pk: 900002,
      uuid: "00000000-0000-4000-a000-000000000002",
    },
  });
}

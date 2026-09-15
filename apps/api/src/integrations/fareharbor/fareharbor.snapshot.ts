import { extractFareharborBookingMetadata } from "./fareharbor.payload";

export type FareharborCustomerSnapshot = {
  pk: string;
  customerType?: string;
  checkinStatus?: string;
  sequence: number;
};

export type FareharborBookingSnapshot = {
  uuid: string;
  pk?: string;
  status: string;
  partySize?: number;
  sourceType?: string;
  bookedAt?: Date;
  cancelledAt?: Date;
  rebookedFromUuid?: string;
  rebookedToUuid?: string;
  isSuperseded: boolean;
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
    emailMarketingOptIn?: boolean;
    smsOptIn?: boolean;
  };
  availability?: {
    pk: string;
    startAt?: Date;
    endAt?: Date;
    capacity?: number;
    status?: string;
    item?: {
      pk: string;
      name?: string;
    };
  };
  customers: FareharborCustomerSnapshot[];
};

export function extractFareharborBookingSnapshot(
  body: unknown,
): FareharborBookingSnapshot {
  const metadata = extractFareharborBookingMetadata(body);
  if (!isPlainObject(body) || !isPlainObject(body.booking)) {
    throw new Error("invalid_payload");
  }

  const booking = body.booking;
  const cancellation = isPlainObject(booking.cancellation)
    ? booking.cancellation
    : undefined;

  return {
    uuid: metadata.uuid,
    pk: metadata.pk === undefined ? undefined : String(metadata.pk),
    status: metadata.status?.trim() || "unknown",
    partySize: integerValue(booking.customer_count),
    sourceType: stringValue(booking.source),
    bookedAt: dateValue(booking.created_at ?? booking.created),
    cancelledAt: dateValue(cancellation?.cancelled_at),
    rebookedFromUuid: metadata.rebookedFrom,
    rebookedToUuid: metadata.rebookedTo,
    isSuperseded: Boolean(metadata.rebookedTo),
    contact: extractContact(booking.contact),
    availability: extractAvailability(booking.availability),
    customers: extractCustomers(booking.customers),
  };
}

function extractContact(
  value: unknown,
): FareharborBookingSnapshot["contact"] {
  if (!isPlainObject(value)) {
    return undefined;
  }

  return {
    name: stringValue(value.name),
    email: stringValue(value.email),
    phone: stringValue(value.phone),
    emailMarketingOptIn: booleanValue(
      value.email_marketing_opt_in ?? value.is_subscribed,
    ),
    smsOptIn: booleanValue(value.sms_opt_in),
  };
}

function extractAvailability(
  value: unknown,
): FareharborBookingSnapshot["availability"] {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const pk = idValue(value.pk);
  if (!pk) {
    return undefined;
  }

  const item = isPlainObject(value.item) ? value.item : undefined;
  const itemPk = item ? idValue(item.pk) : undefined;

  return {
    pk,
    startAt: dateValue(value.start_at),
    endAt: dateValue(value.end_at),
    capacity: integerValue(value.capacity),
    status: stringValue(value.online_booking_status),
    item:
      itemPk === undefined
        ? undefined
        : {
            pk: itemPk,
            name: stringValue(item?.name),
          },
  };
}

function extractCustomers(value: unknown): FareharborCustomerSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const customers: FareharborCustomerSnapshot[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry)) {
      continue;
    }

    const pk = idValue(entry.pk);
    if (!pk) {
      continue;
    }

    const customerType = isPlainObject(entry.customer_type)
      ? stringValue(entry.customer_type.singular)
      : undefined;

    customers.push({
      pk,
      customerType,
      checkinStatus: stringValue(entry.checkin_status),
      sequence: index,
    });
  }

  return customers;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function idValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return stringValue(value);
}

function integerValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function dateValue(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

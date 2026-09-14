export type FareharborBookingMetadata = {
  uuid: string;
  pk?: number | string;
  status?: string;
  rebookedFrom?: string;
  rebookedTo?: string;
};

export function extractFareharborBookingMetadata(
  body: unknown,
): FareharborBookingMetadata {
  if (!isPlainObject(body)) {
    throw new Error("invalid_payload");
  }

  const booking = body.booking;
  if (!isPlainObject(booking)) {
    throw new Error("invalid_payload");
  }

  if (typeof booking.uuid !== "string" || booking.uuid.trim().length === 0) {
    throw new Error("invalid_payload");
  }

  return {
    uuid: booking.uuid.trim(),
    pk:
      typeof booking.pk === "number" || typeof booking.pk === "string"
        ? booking.pk
        : undefined,
    status: typeof booking.status === "string" ? booking.status : undefined,
    rebookedFrom: extractRelatedBookingId(booking.rebooked_from),
    rebookedTo: extractRelatedBookingId(booking.rebooked_to),
  };
}

function extractRelatedBookingId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (
    isPlainObject(value) &&
    typeof value.uuid === "string" &&
    value.uuid.trim()
  ) {
    return value.uuid.trim();
  }

  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

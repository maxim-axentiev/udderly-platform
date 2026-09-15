export const WHEREWOLF_API_BASE_URL = "https://api.wherewolf.co.nz";
export const WHEREWOLF_REQUEST_TIMEOUT_MS = 20_000;
export const WHEREWOLF_GUEST_SELECTION_CROPPED = "cropped" as const;

export const WHEREWOLF_PROVIDER = "wherewolf";
export const WHEREWOLF_GUEST_ENTITY = "guest";
export const WHEREWOLF_GUEST_VISIT_ENTITY = "guest_visit";
export const WHEREWOLF_RESERVATION_ENTITY = "reservation";
export const WHEREWOLF_BOOKING_ALIAS_ENTITY = "booking_alias";
export const WHEREWOLF_ACTIVITY_OBJECT_TYPE = "activity";
export const INTERNAL_VISIT = "visit";
export const INTERNAL_BOOKING = "booking";

export const DOCUMENTED_BOOKING_FIELDS = [
  "id",
  "dateBegin",
  "dateEnd",
  "status",
  "customer",
  "web",
] as const;

export const DOCUMENTED_GUEST_FIELDS = ["id", "email", "pool"] as const;

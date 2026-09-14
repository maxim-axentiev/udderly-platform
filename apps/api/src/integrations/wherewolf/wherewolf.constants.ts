export const WHEREWOLF_API_BASE_URL = "https://api.wherewolf.co.nz";
export const WHEREWOLF_REQUEST_TIMEOUT_MS = 20_000;
export const WHEREWOLF_GUEST_SELECTION_CROPPED = "cropped" as const;

export const DOCUMENTED_BOOKING_FIELDS = [
  "id",
  "dateBegin",
  "dateEnd",
  "status",
  "customer",
  "web",
] as const;

export const DOCUMENTED_GUEST_FIELDS = ["id", "email", "pool"] as const;
